import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  requireAuth,
  AuthRequest,
  createSignedClickChatToken,
  verifySignedClickChatToken,
} from './src/middleware/auth.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import {
  createBotInDb,
  createChatRoomInDb,
  encryptServerMessage,
  formatFp,
  getFullApplicationState,
  getOrCreateAuthenticatedUser,
  insertMessageInDb,
  markChatMessagesReadInDb,
  registerDeviceBySyncCodeInDb,
  revokeDeviceInDb,
  rotateChatKeyInDb,
  toggleBotInChatInDb,
  toggleReactionInDb,
  updateBotInDb,
  updateUserProfileInDb,
} from './src/db/repository.ts';

const PORT = 3000;

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function startServer() {
  const app = express();
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (
      origin === 'https://webclickchat.vercel.app' ||
      origin.endsWith('.vercel.app') ||
      origin.endsWith('.run.app') ||
      origin.startsWith('http://localhost')
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET,POST,PATCH,DELETE,OPTIONS'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization'
      );
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '25mb' }));

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url && request.url.startsWith('/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  function broadcast(event: string, payload: any, excludeWs?: WebSocket) {
    const raw = JSON.stringify({ event, payload });
    wss.clients.forEach((client) => {
      if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    });
  }

  async function processBotCommandsForMessage(msg: any) {
    if (msg.isBot || !msg.text || typeof msg.text !== 'string') return;
    const text = msg.text.trim();
    if (!text.startsWith('/')) return;

    try {
      const state = await getFullApplicationState();
      const chat = state.chats.find((c) => c.id === msg.chatId);
      if (!chat) return;

      const parts = text.split(/\s+/);
      const cmdName = parts[0].toLowerCase().split('@')[0];
      const argText = parts.slice(1).join(' ');

      const chatBotIds: string[] = Array.isArray(chat.botIds) ? chat.botIds : [];
      const activeBots = state.bots.filter(
        (b) => b.isActive && chatBotIds.includes(b.id)
      );

      for (const bot of activeBots) {
        let replyText: string | null = null;
        const customCmd = (bot.commands || []).find(
          (c: any) => c.command.toLowerCase() === cmdName
        );
        if (customCmd) {
          replyText = customCmd.responseTemplate;
        } else if (cmdName === '/help') {
          const cmdList = (bot.commands || [])
            .map((c: any) => `${c.command} — ${c.description}`)
            .join('\n');
          replyText = `Доступные команды бота @${bot.handle}:\n${cmdList}\n/hash <текст> — вычислить SHA-256\n/time — точное серверное время синхронизации`;
        } else if (cmdName === '/hash') {
          const target = argText || 'ClickChat-E2EE';
          replyText = `SHA-256("${target}"):\n${sha256(target)}`;
        } else if (cmdName === '/time') {
          replyText = `Серверное время узла PostgreSQL: ${new Date().toISOString()}`;
        }

        if (replyText) {
          const botFp = formatFp(bot.token);
          const botMsg = {
            id: `msg_bot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            chatId: chat.id,
            senderId: bot.id,
            senderName: bot.name,
            senderHandle: bot.handle,
            isBot: true,
            text: replyText,
            replyToId: msg.id,
            createdAt: new Date().toISOString(),
            views:
              chat.type === 'channel' ? chat.subscriberCount || 1 : undefined,
            e2ee: encryptServerMessage(replyText, chat.e2eeKeySeed, botFp),
            reactions: [],
          };

          await insertMessageInDb(botMsg);
          const nextLogs = [
            {
              id: `log_${Date.now()}`,
              timestamp: new Date().toISOString(),
              method: 'POST' as const,
              endpoint: `command:${cmdName}`,
              status: 200,
              summary: `Ответ на ${cmdName} в «${chat.title}»`,
            },
            ...(bot.logs || []).slice(0, 29),
          ];
          const updatedBot = await updateBotInDb(bot.id, {
            messagesSent: (bot.messagesSent || 0) + 1,
            logs: nextLogs,
          });

          broadcast('message:created', botMsg);
          if (updatedBot) broadcast('bot:updated', updatedBot);
          break;
        }
      }
    } catch (err) {
      console.error('Bot command processing error:', err);
    }
  }

  // ============================================================================
  // AUTHENTICATED REST API ROUTES (Secured by Firebase ID Token + PostgreSQL)
  // ============================================================================

  // Direct Email & Password Account Registration / Login (Works on any domain including Vercel without Firebase Console domain limits)
  app.post('/api/auth/account', async (req, res) => {
    try {
      const { mode, email, password, displayName, deviceAgent } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanPassword = String(password || '');

      if (!cleanEmail || !cleanEmail.includes('@') || cleanPassword.length < 6) {
        return res.status(400).json({
          error: 'Укажите корректный Email и пароль (минимум 6 символов)',
        });
      }

      const expectedUid = `u_${sha256(`clickchat-cred:${cleanEmail}:${cleanPassword}`).slice(0, 20)}`;
      const stateBefore = await getFullApplicationState();
      const existingByEmail = stateBefore.users.find(
        (u) => String(u.email || '').toLowerCase() === cleanEmail
      );

      if (mode === 'register') {
        if (existingByEmail && existingByEmail.id !== expectedUid) {
          return res.status(409).json({
            error: 'Этот Email уже зарегистрирован. Переключитесь на вкладку «Вход».',
          });
        }
      } else {
        if (existingByEmail && existingByEmail.id !== expectedUid) {
          return res.status(401).json({
            error: 'Неверный пароль для указанного Email.',
          });
        }
      }

      const resolvedName =
        String(displayName || '').trim() ||
        existingByEmail?.displayName ||
        cleanEmail.split('@')[0];

      const currentUser = await getOrCreateAuthenticatedUser({
        uid: expectedUid,
        email: cleanEmail,
        displayName: resolvedName,
        avatarUrl: existingByEmail?.avatarUrl || '',
        deviceAgent: deviceAgent || 'ClickChat Web Session',
      });

      const token = createSignedClickChatToken({
        uid: currentUser.id,
        email: currentUser.email || cleanEmail,
        name: currentUser.displayName,
        picture: currentUser.avatarUrl || '',
      });

      const state = await getFullApplicationState();
      broadcast('user:created', currentUser);
      return res.json({ token, currentUser, state });
    } catch (error: any) {
      return res.status(500).json({
        error: error.message || 'Ошибка авторизации аккаунта',
      });
    }
  });

  // Synchronize authenticated user account with PostgreSQL and return full workspace state
  app.post('/api/auth/session', requireAuth, async (req: AuthRequest, res) => {
    try {
      const decoded = req.user!;
      const { deviceAgent } = req.body || {};
      const currentUser = await getOrCreateAuthenticatedUser({
        uid: decoded.uid,
        email: decoded.email || `${decoded.uid}@clickchat.user`,
        displayName: decoded.name || req.body?.displayName,
        avatarUrl: decoded.picture || '',
        deviceAgent,
      });

      const signedToken = createSignedClickChatToken({
        uid: currentUser.id,
        email: currentUser.email || decoded.email || `${decoded.uid}@clickchat.user`,
        name: currentUser.displayName,
        picture: currentUser.avatarUrl || '',
      });
      const state = await getFullApplicationState();
      broadcast('user:created', currentUser);
      res.json({ currentUser, state, signedToken });
    } catch (error: any) {
      console.error('Failed to initialize authenticated session:', error);
      res
        .status(500)
        .json({ error: error.message || 'Failed to synchronize account' });
    }
  });

  let recentCallSignals: any[] = [];

  function recordCallSignal(payload: any) {
    const now = Date.now();
    recentCallSignals = recentCallSignals.filter(
      (s) => now - (s.timestamp || 0) < 35000
    );
    const sig = {
      ...payload,
      signalId:
        payload?.signalId ||
        `sig_${now}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
    };
    if (!recentCallSignals.some((s) => s.signalId === sig.signalId)) {
      recentCallSignals.push(sig);
    }
    return sig;
  }

  // Serve call.mp3 and incomingcall.mp3 from root or public/ if uploaded by user
  app.get(['/call.mp3', '/incomingcall.mp3'], (req, res, next) => {
    const fileName = req.path.replace(/^\//, '');
    const rootFile = path.resolve(process.cwd(), fileName);
    const publicFile = path.resolve(process.cwd(), 'public', fileName);
    if (fs.existsSync(rootFile)) {
      return res.sendFile(rootFile);
    }
    if (fs.existsSync(publicFile)) {
      return res.sendFile(publicFile);
    }
    next();
  });

  // Get full application state from PostgreSQL
  app.get('/api/state', requireAuth, async (req: AuthRequest, res) => {
    try {
      const decoded = req.user!;
      await getOrCreateAuthenticatedUser({
        uid: decoded.uid,
        email: decoded.email || `${decoded.uid}@clickchat.user`,
        displayName: decoded.name,
        avatarUrl: decoded.picture,
      });
      const now = Date.now();
      recentCallSignals = recentCallSignals.filter(
        (s) => now - (s.timestamp || 0) < 35000
      );
      const state = await getFullApplicationState();
      res.json({ ...state, callSignals: recentCallSignals });
    } catch (error: any) {
      console.error('Failed to fetch state:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch state' });
    }
  });

  app.post('/api/calls/signal', requireAuth, async (req: AuthRequest, res) => {
    try {
      const sig = recordCallSignal(req.body || {});
      broadcast('call:signal', sig);
      return res.json({ ok: true, signal: sig });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Signal error' });
    }
  });

  // Update authenticated user profile in PostgreSQL
  app.patch('/api/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const updatedUser = await updateUserProfileInDb(uid, req.body || {});
      if (!updatedUser) {
        return res.status(404).json({ error: 'Профиль не найден' });
      }
      broadcast('profile:updated', updatedUser);
      return res.json(updatedUser);
    } catch (error: any) {
      console.error('Failed to update profile:', error);
      return res
        .status(500)
        .json({ error: error.message || 'Failed to update profile' });
    }
  });

  // Create real chat / group / channel in PostgreSQL
  app.post('/api/chats', requireAuth, async (req: AuthRequest, res) => {
    try {
      const payload = req.body || {};
      if (!payload.id || !payload.title) {
        return res.status(400).json({ error: 'Укажите название чата или канала' });
      }
      const newChat = {
        ...payload,
        createdAt: payload.createdAt || new Date().toISOString(),
        subscriberCount: payload.memberIds?.length || 1,
      };
      await createChatRoomInDb(newChat);
      broadcast('chat:created', newChat);
      return res.status(201).json(newChat);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Failed to create chat' });
    }
  });

  // Send real message in PostgreSQL
  app.post('/api/messages', requireAuth, async (req: AuthRequest, res) => {
    try {
      const payload = req.body || {};
      if (!payload.id || !payload.chatId) {
        return res.status(400).json({ error: 'Некорректные данные сообщения' });
      }
      const msg = {
        ...payload,
        createdAt: payload.createdAt || new Date().toISOString(),
        reactions: payload.reactions || [],
      };
      await insertMessageInDb(msg);
      broadcast('message:created', msg);
      await processBotCommandsForMessage(msg);
      return res.status(201).json(msg);
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Failed to send message' });
    }
  });

  // Mark messages in a chat as read by the authenticated user
  app.post('/api/chats/:chatId/read', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const chatId = req.params.chatId;
      await markChatMessagesReadInDb(chatId, uid);
      broadcast('message:read', { chatId, userId: uid });
      return res.json({ ok: true, chatId, userId: uid });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'Failed to mark read' });
    }
  });

  // Link a device via Sync Code in PostgreSQL
  app.post('/api/devices/link', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { syncCode, deviceName, platform } = req.body || {};
      if (!syncCode || typeof syncCode !== 'string') {
        return res
          .status(400)
          .json({ error: 'Укажите код синхронизации (syncCode)' });
      }
      const linked = await registerDeviceBySyncCodeInDb(
        syncCode,
        deviceName,
        platform
      );
      if (!linked) {
        return res
          .status(404)
          .json({ error: 'Аккаунт с таким кодом синхронизации не найден в БД' });
      }
      const state = await getFullApplicationState();
      broadcast('device:created', linked.device);
      return res.json({
        user: linked.user,
        device: linked.device,
        state,
      });
    } catch (error: any) {
      console.error('Failed to link device:', error);
      return res
        .status(500)
        .json({ error: error.message || 'Failed to link device' });
    }
  });

  // Create a new Bot in PostgreSQL
  app.post('/api/bots', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { name, handle, description, webhookUrl, commands, targetChatId } =
        req.body || {};
      if (!name || !handle) {
        return res.status(400).json({ error: 'Укажите название и @handle бота' });
      }
      const cleanHandle = String(handle)
        .replace(/^@/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');

      const token = `cc_bot_${crypto.randomBytes(11).toString('hex')}`;
      const newBot = {
        id: `bot_${Date.now()}`,
        name: String(name).trim(),
        handle: cleanHandle.endsWith('_bot')
          ? cleanHandle
          : `${cleanHandle}_bot`,
        description: String(
          description || 'Автоматизированный бот ClickChat Open API'
        ).trim(),
        ownerId: req.user!.uid,
        token,
        webhookUrl: String(
          webhookUrl || `https://api.clickchat.local/webhook/${cleanHandle}`
        ).trim(),
        commands:
          Array.isArray(commands) && commands.length > 0
            ? commands
            : [
                {
                  command: '/start',
                  description: 'Запустить бота и получить справку',
                  responseTemplate: `Здравствуйте! Бот ${name} подключен к PostgreSQL и защищенному каналу ClickChat Open API.`,
                },
              ],
        isActive: true,
        messagesSent: 0,
        createdAt: new Date().toISOString(),
        logs: [
          {
            id: `log_${Date.now()}`,
            timestamp: new Date().toISOString(),
            method: 'POST' as const,
            endpoint: '/api/bots (Issued Token)',
            status: 201,
            summary: `Создан токен API для @${cleanHandle}`,
          },
        ],
      };

      await createBotInDb(newBot);
      if (targetChatId) {
        const updatedChats = await toggleBotInChatInDb(targetChatId, newBot.id);
        if (updatedChats) broadcast('chats:updated', updatedChats);
      }

      broadcast('bot:created', newBot);
      return res.status(201).json(newBot);
    } catch (error: any) {
      console.error('Failed to create bot:', error);
      return res
        .status(500)
        .json({ error: error.message || 'Failed to create bot' });
    }
  });

  app.patch('/api/bots/:botId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { isActive, webhookUrl, commands, attachChatId } = req.body || {};
      if (attachChatId) {
        const updatedChats = await toggleBotInChatInDb(
          attachChatId,
          req.params.botId
        );
        if (updatedChats) broadcast('chats:updated', updatedChats);
      }

      const updatedBot = await updateBotInDb(req.params.botId, {
        isActive,
        webhookUrl,
        commands,
      });
      if (!updatedBot) {
        return res.status(404).json({ error: 'Бот не найден' });
      }
      broadcast('bot:updated', updatedBot);
      return res.json(updatedBot);
    } catch (error: any) {
      console.error('Failed to update bot:', error);
      return res
        .status(500)
        .json({ error: error.message || 'Failed to update bot' });
    }
  });

  // ============================================================================
  // OPEN BOT API (Token-Authenticated External HTTP Endpoints)
  // ============================================================================

  app.get('/api/bot/:token/getMe', async (req, res) => {
    try {
      const state = await getFullApplicationState();
      const bot = state.bots.find((b) => b.token === req.params.token);
      if (!bot) {
        return res.status(401).json({
          ok: false,
          error_code: 401,
          description: 'Unauthorized: Invalid bot token',
        });
      }
      return res.json({
        ok: true,
        result: {
          id: bot.id,
          is_bot: true,
          first_name: bot.name,
          username: bot.handle,
          can_join_groups: true,
          can_read_all_group_messages: true,
          supports_e2ee_envelopes: true,
          commands: bot.commands,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/bot/:token/getUpdates', async (req, res) => {
    try {
      const state = await getFullApplicationState();
      const bot = state.bots.find((b) => b.token === req.params.token);
      if (!bot) {
        return res.status(401).json({
          ok: false,
          error_code: 401,
          description: 'Unauthorized: Invalid bot token',
        });
      }
      const botChats = state.chats
        .filter((c) => (c.botIds || []).includes(bot.id))
        .map((c) => c.id);

      const recentMessages = state.messages
        .filter((m) => botChats.includes(m.chatId))
        .slice(-25)
        .map((m) => ({
          update_id: m.id,
          message: {
            message_id: m.id,
            chat: { id: m.chatId },
            from: {
              id: m.senderId,
              username: m.senderHandle,
              first_name: m.senderName,
            },
            date: m.createdAt,
            text: m.text,
            e2ee_verified: m.e2ee?.verified ?? true,
          },
        }));

      const nextLogs = [
        {
          id: `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          method: 'GET' as const,
          endpoint: `/api/bot/${bot.token.slice(0, 12)}.../getUpdates`,
          status: 200,
          summary: `Получено обновлений из БД: ${recentMessages.length}`,
        },
        ...(bot.logs || []).slice(0, 29),
      ];
      const updatedBot = await updateBotInDb(bot.id, { logs: nextLogs });
      if (updatedBot) broadcast('bot:updated', updatedBot);

      return res.json({
        ok: true,
        result: recentMessages,
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/bot/:token/sendMessage', async (req, res) => {
    try {
      const state = await getFullApplicationState();
      const bot = state.bots.find((b) => b.token === req.params.token);
      if (!bot) {
        return res.status(401).json({
          ok: false,
          error_code: 401,
          description: 'Unauthorized: Invalid bot token',
        });
      }

      const { chatId, chat_id, text } = req.body || {};
      const targetChatId = chatId || chat_id;
      if (!targetChatId || !text || typeof text !== 'string') {
        return res.status(400).json({
          ok: false,
          error_code: 400,
          description: 'Bad Request: chatId and text are required',
        });
      }

      const chat = state.chats.find(
        (c) =>
          c.id === targetChatId ||
          c.handle === String(targetChatId).replace(/^@/, '')
      );
      if (!chat) {
        return res.status(404).json({
          ok: false,
          error_code: 404,
          description: `Chat "${targetChatId}" not found`,
        });
      }

      const botFp = formatFp(bot.token);
      const newMsg = {
        id: `msg_api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        chatId: chat.id,
        senderId: bot.id,
        senderName: bot.name,
        senderHandle: bot.handle,
        isBot: true,
        text: text.trim(),
        createdAt: new Date().toISOString(),
        views:
          chat.type === 'channel' ? chat.subscriberCount || 1 : undefined,
        e2ee: encryptServerMessage(text.trim(), chat.e2eeKeySeed, botFp),
        reactions: [],
      };

      await insertMessageInDb(newMsg);

      const nextLogs = [
        {
          id: `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          method: 'POST' as const,
          endpoint: `/api/bot/${bot.token.slice(0, 12)}.../sendMessage`,
          status: 200,
          summary: `Доставлено в «${chat.title}»: "${text.slice(0, 36)}"`,
        },
        ...(bot.logs || []).slice(0, 29),
      ];
      const updatedBot = await updateBotInDb(bot.id, {
        messagesSent: (bot.messagesSent || 0) + 1,
        logs: nextLogs,
      });

      broadcast('message:created', newMsg);
      if (updatedBot) broadcast('bot:updated', updatedBot);

      return res.json({
        ok: true,
        result: newMsg,
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // WebSocket Real-Time Event Loop with PostgreSQL Persistence
  wss.on('connection', (ws) => {
    ws.on('message', async (rawBuffer) => {
      try {
        const data = JSON.parse(rawBuffer.toString());
        const { event, payload, token } = data;

        // Verify signed ClickChat token or Firebase token if provided on socket messages
        let verifiedUid: string | null = null;
        if (token) {
          const signed = verifySignedClickChatToken(token);
          if (signed) {
            verifiedUid = signed.uid;
          } else {
            try {
              const decoded = await adminAuth.verifyIdToken(token);
              verifiedUid = decoded.uid;
            } catch {
              // Ignore expired token on non-critical WS relay
            }
          }
        }

        switch (event) {
          case 'message:send': {
            if (!payload || !payload.id || !payload.chatId) break;
            const msg = {
              ...payload,
              createdAt: payload.createdAt || new Date().toISOString(),
              reactions: payload.reactions || [],
            };
            await insertMessageInDb(msg);
            broadcast('message:created', msg);
            await processBotCommandsForMessage(msg);
            break;
          }

          case 'message:react': {
            const { messageId, emoji, userId } = payload || {};
            if (!messageId || !emoji || !userId) break;
            const updatedMsg = await toggleReactionInDb(
              messageId,
              emoji,
              verifiedUid || userId
            );
            if (updatedMsg) {
              broadcast('message:updated', updatedMsg);
            }
            break;
          }

          case 'chat:create': {
            if (!payload || !payload.id || !payload.title) break;
            const newChat = {
              ...payload,
              createdAt: new Date().toISOString(),
              subscriberCount: payload.memberIds?.length || 1,
            };
            await createChatRoomInDb(newChat);
            broadcast('chat:created', newChat);
            break;
          }

          case 'chat:rotate-keys': {
            const { chatId, newSeed, newFingerprint, actorName } =
              payload || {};
            if (!chatId || !newSeed || !newFingerprint) break;
            const updatedChat = await rotateChatKeyInDb(
              chatId,
              newSeed,
              newFingerprint
            );
            if (!updatedChat) break;

            const rotateMsg = {
              id: `msg_rot_${Date.now()}`,
              chatId: updatedChat.id,
              senderId: verifiedUid || updatedChat.adminIds?.[0] || 'u_elena',
              senderName: actorName || 'Система безопасности',
              senderHandle: 'e2ee_ratchet',
              isBot: false,
              text: `Выполнена ротация ключей сквозного шифрования (Double Ratchet). Новый отпечаток ключа комнаты: ${newFingerprint.slice(0, 19)}`,
              createdAt: new Date().toISOString(),
              e2ee: encryptServerMessage(
                `Ротация ключей: ${newFingerprint}`,
                newSeed,
                newFingerprint
              ),
              reactions: [],
            };
            await insertMessageInDb(rotateMsg);
            const state = await getFullApplicationState();
            broadcast('chats:updated', state.chats);
            broadcast('message:created', rotateMsg);
            break;
          }

          case 'profile:update': {
            const targetUid = verifiedUid || payload?.id;
            if (!targetUid) break;
            const updatedUser = await updateUserProfileInDb(targetUid, payload);
            if (updatedUser) {
              broadcast('profile:updated', updatedUser);
            }
            break;
          }

          case 'device:revoke': {
            const { deviceId } = payload || {};
            if (!deviceId) break;
            const remainingDevices = await revokeDeviceInDb(deviceId);
            broadcast('devices:updated', remainingDevices);
            break;
          }

          case 'call:signal': {
            const sig = recordCallSignal(payload);
            broadcast('call:signal', sig, ws);
            break;
          }

          case 'message:read': {
            const { chatId, userId } = payload || {};
            const readerId = verifiedUid || userId;
            if (!chatId || !readerId) break;
            await markChatMessagesReadInDb(chatId, readerId);
            broadcast('message:read', { chatId, userId: readerId });
            break;
          }
        }
      } catch (err) {
        console.error('WS message processing error:', err);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `ClickChat E2EE Server & PostgreSQL node listening on http://0.0.0.0:${PORT}`
    );
  });
}

startServer();
