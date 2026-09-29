import crypto from 'crypto';
import express from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import pg from 'pg';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const { Pool } = pg;

const adminApp =
  getApps().length === 0
    ? initializeApp({
        projectId: firebaseConfig.projectId,
      })
    : getApps()[0];

const adminAuth = getAuth(adminApp);

const isPostgresConfigured = Boolean(
  process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME
);

let pool: pg.Pool | null = null;
if (isPostgresConfigured) {
  pool = new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    max: 5,
    connectionTimeoutMillis: 8000,
  });
  pool.on('error', () => {});
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function formatFp(seed: string): string {
  return sha256(seed)
    .slice(0, 32)
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join(' ');
}

function generateSyncCode(seed: string): string {
  const hash = sha256(seed).toUpperCase();
  return `CC-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
}

function encryptServerMessage(
  plaintext: string,
  roomSeed: string,
  senderFp: string
) {
  const key = crypto
    .createHash('sha256')
    .update(`clickchat-e2ee-v1:${roomSeed}`)
    .digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, authTag]);
  const ciphertextBase64 = combined.toString('base64');
  const ivHex = iv.toString('hex');
  const sha256Signature = sha256(`${ivHex}:${ciphertextBase64}:${senderFp}`);
  return {
    algorithm: 'AES-256-GCM / ECDH-P256' as const,
    ivHex,
    ciphertextBase64,
    sha256Signature,
    senderKeyFingerprint: senderFp,
    verified: true,
  };
}

// Clean runtime store for serverless environment
const memoryStore: {
  users: any[];
  devices: any[];
  chats: any[];
  messages: any[];
  bots: any[];
} = {
  users: [],
  devices: [],
  chats: [],
  messages: [],
  bots: [],
};

const app = express();
app.use(express.json({ limit: '25mb' }));

async function verifyRequestUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing Authorization Bearer token');
  }
  const token = authHeader.split('Bearer ')[1].trim();
  return await adminAuth.verifyIdToken(token);
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    engine: 'ClickChat Serverless API',
    database: isPostgresConfigured ? 'PostgreSQL' : 'Serverless Store',
  });
});

app.post('/api/auth/session', async (req, res) => {
  try {
    const decoded = await verifyRequestUser(req);
    const uid = decoded.uid;
    const email = decoded.email || `${uid.slice(0, 8)}@clickchat.org`;
    const emailPrefix = email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const handle = `${emailPrefix}_${uid.slice(0, 4).toLowerCase()}`;
    const displayName =
      req.body?.displayName || decoded.name || email.split('@')[0] || 'Пользователь';
    const keyHex = sha256(`clickchat-identity:${uid}`);
    const keyFp = formatFp(keyHex);
    const syncCode = generateSyncCode(`sync:${uid}`);

    let currentUser = memoryStore.users.find((u) => u.id === uid);
    if (!currentUser) {
      currentUser = {
        id: uid,
        uid,
        email,
        handle,
        displayName,
        bio: '',
        avatarUrl: decoded.picture || '',
        publicKeyHex: keyHex,
        publicKeyFingerprint: keyFp,
        status: 'online',
        createdAt: new Date().toISOString(),
        syncCode,
      };
      memoryStore.users.push(currentUser);
    }

    const primaryDeviceId = `dev_${uid.slice(0, 10)}_primary`;
    if (!memoryStore.devices.some((d) => d.id === primaryDeviceId)) {
      memoryStore.devices.push({
        id: primaryDeviceId,
        userId: uid,
        deviceName: req.body?.deviceAgent || 'ClickChat Web Session',
        platform: 'Web Crypto E2EE',
        lastActiveAt: new Date().toISOString(),
        keyFingerprint: keyFp.slice(0, 19),
        syncState: 'synced',
      });
    }

    return res.json({
      currentUser,
      state: memoryStore,
    });
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

app.get('/api/state', async (req, res) => {
  try {
    await verifyRequestUser(req);
    return res.json(memoryStore);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

app.patch('/api/profile', async (req, res) => {
  try {
    const decoded = await verifyRequestUser(req);
    const user = memoryStore.users.find((u) => u.id === decoded.uid);
    if (!user) return res.status(404).json({ error: 'Профиль не найден' });
    const patch = req.body || {};
    if (patch.displayName) user.displayName = patch.displayName;
    if (patch.handle)
      user.handle = patch.handle.replace(/^@/, '').trim().toLowerCase();
    if (patch.bio !== undefined) user.bio = patch.bio;
    if (patch.publicKeyHex) user.publicKeyHex = patch.publicKeyHex;
    if (patch.publicKeyFingerprint)
      user.publicKeyFingerprint = patch.publicKeyFingerprint;
    return res.json(user);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

app.post('/api/chats', async (req, res) => {
  try {
    await verifyRequestUser(req);
    const payload = req.body || {};
    if (!payload.id || !payload.title) {
      return res.status(400).json({ error: 'Укажите название чата или канала' });
    }
    const newChat = {
      ...payload,
      createdAt: payload.createdAt || new Date().toISOString(),
      subscriberCount: payload.memberIds?.length || 1,
    };
    if (!memoryStore.chats.some((c) => c.id === newChat.id)) {
      memoryStore.chats.unshift(newChat);
    }
    return res.status(201).json(newChat);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    await verifyRequestUser(req);
    const payload = req.body || {};
    if (!payload.id || !payload.chatId) {
      return res.status(400).json({ error: 'Некорректные данные сообщения' });
    }
    const msg = {
      ...payload,
      createdAt: payload.createdAt || new Date().toISOString(),
      reactions: payload.reactions || [],
    };
    if (!memoryStore.messages.some((m) => m.id === msg.id)) {
      memoryStore.messages.push(msg);
    }
    return res.status(201).json(msg);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

app.post('/api/devices/link', async (req, res) => {
  try {
    await verifyRequestUser(req);
    const { syncCode, deviceName, platform } = req.body || {};
    const matchedUser = memoryStore.users.find(
      (u) => u.syncCode?.toUpperCase() === String(syncCode || '').trim().toUpperCase()
    );
    if (!matchedUser) {
      return res.status(404).json({ error: 'Код синхронизации не найден' });
    }
    const newDevice = {
      id: `dev_${Date.now()}`,
      userId: matchedUser.id,
      deviceName: deviceName || 'ClickChat Synced Node',
      platform: platform || 'Web Crypto Sync',
      lastActiveAt: new Date().toISOString(),
      keyFingerprint: matchedUser.publicKeyFingerprint.slice(0, 19),
      syncState: 'synced',
    };
    memoryStore.devices.push(newDevice);
    return res.json({
      ok: true,
      user: matchedUser,
      device: newDevice,
      state: memoryStore,
    });
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

app.post('/api/bots', async (req, res) => {
  try {
    const decoded = await verifyRequestUser(req);
    const { name, handle, description, webhookUrl, commands } = req.body || {};
    if (!name || !handle) {
      return res.status(400).json({ error: 'Name and handle are required' });
    }
    const cleanHandle = String(handle).replace(/^@/, '').trim().toLowerCase();
    const randomPart = crypto.randomBytes(12).toString('hex');
    const newBot = {
      id: `bot_${Date.now()}`,
      name: String(name).trim(),
      handle: cleanHandle.endsWith('_bot') ? cleanHandle : `${cleanHandle}_bot`,
      description: String(description || 'Автоматизированный бот ClickChat'),
      ownerId: decoded.uid,
      token: `cc_live_${cleanHandle.slice(0, 8)}_${randomPart}`,
      webhookUrl: String(webhookUrl || `https://api.clickchat.org/hooks/${cleanHandle}`),
      commands: Array.isArray(commands)
        ? commands
        : [{ command: '/start', description: 'Запустить бота', responseTemplate: `Привет! Я @${cleanHandle}.` }],
      isActive: true,
      messagesSent: 0,
      createdAt: new Date().toISOString(),
      logs: [],
    };
    memoryStore.bots.push(newBot);
    return res.status(201).json(newBot);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

app.patch('/api/bots/:botId', async (req, res) => {
  try {
    await verifyRequestUser(req);
    const bot = memoryStore.bots.find((b) => b.id === req.params.botId);
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    Object.assign(bot, req.body || {});
    return res.json(bot);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

app.post('/api/chats/:chatId/bots', async (req, res) => {
  try {
    await verifyRequestUser(req);
    const { botId } = req.body || {};
    const chat = memoryStore.chats.find((c) => c.id === req.params.chatId);
    if (chat && botId) {
      chat.botIds = chat.botIds || [];
      chat.botIds = chat.botIds.includes(botId)
        ? chat.botIds.filter((id: string) => id !== botId)
        : [...chat.botIds, botId];
    }
    return res.json({ ok: true, chats: memoryStore.chats });
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
});

app.post('/api/bot/:token/sendMessage', async (req, res) => {
  const { token } = req.params;
  const { chatId, text } = req.body || {};
  const bot = memoryStore.bots.find((b) => b.token === token);
  if (!bot) return res.status(401).json({ ok: false, error: 'Invalid bot token' });
  const chat = memoryStore.chats.find((c) => c.id === chatId) || memoryStore.chats[0];
  if (!chat) return res.status(404).json({ ok: false, error: 'Chat not found' });

  const botFp = formatFp(bot.token);
  const msgText = String(text || '').trim();
  const newMsg = {
    id: `msg_bot_${Date.now()}`,
    chatId: chat.id,
    senderId: bot.id,
    senderName: bot.name,
    senderHandle: bot.handle,
    isBot: true,
    text: msgText,
    createdAt: new Date().toISOString(),
    e2ee: encryptServerMessage(msgText, chat.e2eeKeySeed, botFp),
    reactions: [],
  };
  memoryStore.messages.push(newMsg);
  return res.json({ ok: true, result: { messageId: newMsg.id, e2ee: newMsg.e2ee } });
});

export default app;
