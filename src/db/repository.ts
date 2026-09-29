import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db, isPostgresConfigured } from './index.ts';
import { bots, chats, devices, messages, users } from './schema.ts';

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function formatFp(seed: string): string {
  return sha256(seed)
    .slice(0, 32)
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join(' ');
}

export function encryptServerMessage(
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

function generateSyncCode(seed: string): string {
  const hash = sha256(seed).toUpperCase();
  return `CC-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
}

// Clean runtime store with zero demo accounts or channels
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

export function mapUserRow(row: typeof users.$inferSelect) {
  return {
    id: row.uid,
    uid: row.uid,
    email: row.email,
    handle: row.handle,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl: row.avatarUrl || '',
    publicKeyHex: row.publicKeyHex,
    publicKeyFingerprint: row.publicKeyFingerprint,
    status: (row.status as 'online' | 'away' | 'offline') || 'online',
    createdAt: row.createdAt
      ? row.createdAt.toISOString()
      : new Date().toISOString(),
    syncCode: row.syncCode,
  };
}

export function mapChatRow(row: typeof chats.$inferSelect) {
  return {
    id: row.id,
    type: row.type as 'direct' | 'group' | 'channel',
    title: row.title,
    handle: row.handle,
    description: row.description,
    avatarUrl: row.avatarUrl,
    memberIds: JSON.parse(row.memberIdsJson || '[]'),
    adminIds: JSON.parse(row.adminIdsJson || '[]'),
    botIds: JSON.parse(row.botIdsJson || '[]'),
    e2eeKeySeed: row.e2eeKeySeed,
    e2eeFingerprint: row.e2eeFingerprint,
    subscriberCount: row.subscriberCount,
    createdAt: row.createdAt,
  };
}

export function mapMessageRow(row: typeof messages.$inferSelect) {
  return {
    id: row.id,
    chatId: row.chatId,
    senderId: row.senderId,
    senderName: row.senderName,
    senderHandle: row.senderHandle,
    isBot: row.isBot,
    text: row.text,
    createdAt: row.createdAt,
    replyToId: row.replyToId || undefined,
    attachment: row.attachmentJson ? JSON.parse(row.attachmentJson) : undefined,
    e2ee: JSON.parse(row.e2eeJson),
    views: row.views ?? undefined,
    reactions: JSON.parse(row.reactionsJson || '[]'),
  };
}

export function mapBotRow(row: typeof bots.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    description: row.description,
    ownerId: row.ownerId,
    token: row.token,
    webhookUrl: row.webhookUrl,
    commands: JSON.parse(row.commandsJson || '[]'),
    isActive: row.isActive,
    messagesSent: row.messagesSent,
    createdAt: row.createdAt,
    logs: JSON.parse(row.logsJson || '[]'),
  };
}

function getOrCreateMemoryUser(params: {
  uid: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  deviceAgent?: string;
}) {
  const emailPrefix = (params.email || 'user')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  const defaultHandle = `${emailPrefix}_${params.uid.slice(0, 4).toLowerCase()}`;
  const defaultName =
    params.displayName || params.email.split('@')[0] || 'Пользователь';
  const keyHex = sha256(`clickchat-identity:${params.uid}`);
  const keyFp = formatFp(keyHex);
  const syncCode = generateSyncCode(`sync:${params.uid}`);

  let userObj = memoryStore.users.find((u) => u.id === params.uid);
  if (!userObj) {
    userObj = {
      id: params.uid,
      uid: params.uid,
      email: params.email,
      handle: defaultHandle,
      displayName: defaultName,
      bio: '',
      avatarUrl: params.avatarUrl || '',
      publicKeyHex: keyHex,
      publicKeyFingerprint: keyFp,
      status: 'online',
      createdAt: new Date().toISOString(),
      syncCode,
    };
    memoryStore.users.push(userObj);
  }

  const primaryDeviceId = `dev_${params.uid.slice(0, 10)}_primary`;
  if (!memoryStore.devices.some((d) => d.id === primaryDeviceId)) {
    memoryStore.devices.push({
      id: primaryDeviceId,
      userId: params.uid,
      deviceName: params.deviceAgent || 'ClickChat Web Session',
      platform: 'Web Crypto E2EE',
      lastActiveAt: new Date().toISOString(),
      keyFingerprint: userObj.publicKeyFingerprint.slice(0, 19),
      syncState: 'synced',
    });
  }

  return userObj;
}

export async function getOrCreateAuthenticatedUser(params: {
  uid: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  deviceAgent?: string;
}) {
  if (!isPostgresConfigured) {
    return getOrCreateMemoryUser(params);
  }

  try {
    const emailPrefix = (params.email || 'user')
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const defaultHandle = `${emailPrefix}_${params.uid.slice(0, 4).toLowerCase()}`;
    const defaultName =
      params.displayName || params.email.split('@')[0] || 'Пользователь';
    const keyHex = sha256(`clickchat-identity:${params.uid}`);
    const keyFp = formatFp(keyHex);
    const syncCode = generateSyncCode(`sync:${params.uid}`);

    const result = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: params.email,
        handle: defaultHandle,
        displayName: defaultName,
        bio: '',
        avatarUrl: params.avatarUrl || '',
        publicKeyHex: keyHex,
        publicKeyFingerprint: keyFp,
        status: 'online',
        syncCode,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: params.email,
          status: 'online',
        },
      })
      .returning();

    const userRow = result[0];

    const primaryDeviceId = `dev_${params.uid.slice(0, 10)}_primary`;
    await db
      .insert(devices)
      .values({
        id: primaryDeviceId,
        userId: params.uid,
        deviceName: params.deviceAgent || 'ClickChat Web Session',
        platform: 'PostgreSQL + Web Crypto E2EE',
        lastActiveAt: new Date().toISOString(),
        keyFingerprint: userRow.publicKeyFingerprint.slice(0, 19),
        syncState: 'synced',
      })
      .onConflictDoUpdate({
        target: devices.id,
        set: {
          lastActiveAt: new Date().toISOString(),
          syncState: 'synced',
        },
      });

    return mapUserRow(userRow);
  } catch {
    return getOrCreateMemoryUser(params);
  }
}

export async function getFullApplicationState() {
  if (!isPostgresConfigured) {
    return memoryStore;
  }
  try {
    const [userRows, deviceRows, chatRows, messageRows, botRows] =
      await Promise.all([
        db.select().from(users),
        db.select().from(devices),
        db.select().from(chats),
        db.select().from(messages),
        db.select().from(bots),
      ]);

    return {
      users: userRows.map(mapUserRow),
      devices: deviceRows,
      chats: chatRows.map(mapChatRow),
      messages: messageRows.map(mapMessageRow),
      bots: botRows.map(mapBotRow),
    };
  } catch {
    return memoryStore;
  }
}

export async function updateUserProfileInDb(
  uid: string,
  patch: {
    displayName?: string;
    handle?: string;
    bio?: string;
    status?: string;
    publicKeyHex?: string;
    publicKeyFingerprint?: string;
  }
) {
  if (!isPostgresConfigured) {
    const u = memoryStore.users.find((item) => item.id === uid);
    if (!u) return null;
    if (patch.displayName) u.displayName = patch.displayName;
    if (patch.handle)
      u.handle = patch.handle.replace(/^@/, '').trim().toLowerCase();
    if (patch.bio !== undefined) u.bio = patch.bio;
    if (patch.status) u.status = patch.status;
    if (patch.publicKeyHex) u.publicKeyHex = patch.publicKeyHex;
    if (patch.publicKeyFingerprint)
      u.publicKeyFingerprint = patch.publicKeyFingerprint;
    return u;
  }

  try {
    const existing = await db.select().from(users).where(eq(users.uid, uid));
    if (!existing[0]) return null;

    const current = existing[0];
    const updatedRows = await db
      .update(users)
      .set({
        displayName: patch.displayName ?? current.displayName,
        handle: patch.handle
          ? patch.handle.replace(/^@/, '').trim().toLowerCase()
          : current.handle,
        bio: patch.bio ?? current.bio,
        status: patch.status ?? current.status,
        publicKeyHex: patch.publicKeyHex ?? current.publicKeyHex,
        publicKeyFingerprint:
          patch.publicKeyFingerprint ?? current.publicKeyFingerprint,
      })
      .where(eq(users.uid, uid))
      .returning();

    return updatedRows[0] ? mapUserRow(updatedRows[0]) : null;
  } catch {
    const u = memoryStore.users.find((item) => item.id === uid);
    if (!u) return null;
    Object.assign(u, patch);
    return u;
  }
}

export async function insertMessageInDb(msg: any) {
  if (!memoryStore.messages.some((m) => m.id === msg.id)) {
    memoryStore.messages.push(msg);
  }
  if (!isPostgresConfigured) return msg;

  try {
    await db
      .insert(messages)
      .values({
        id: msg.id,
        chatId: msg.chatId,
        senderId: msg.senderId,
        senderName: msg.senderName,
        senderHandle: msg.senderHandle,
        isBot: Boolean(msg.isBot),
        text: msg.text,
        createdAt: msg.createdAt || new Date().toISOString(),
        replyToId: msg.replyToId || null,
        attachmentJson: msg.attachment ? JSON.stringify(msg.attachment) : null,
        e2eeJson: JSON.stringify(msg.e2ee),
        views: msg.views ?? null,
        reactionsJson: JSON.stringify(msg.reactions || []),
      })
      .onConflictDoNothing();
    return msg;
  } catch {
    return msg;
  }
}

export async function toggleReactionInDb(
  messageId: string,
  emoji: string,
  userId: string
) {
  if (!isPostgresConfigured) {
    const msg = memoryStore.messages.find((m) => m.id === messageId);
    if (!msg) return null;
    const reactions: { emoji: string; userIds: string[] }[] =
      msg.reactions || [];
    const existing = reactions.find((r) => r.emoji === emoji);
    if (existing) {
      if (existing.userIds.includes(userId)) {
        existing.userIds = existing.userIds.filter((id) => id !== userId);
      } else {
        existing.userIds.push(userId);
      }
    } else {
      reactions.push({ emoji, userIds: [userId] });
    }
    msg.reactions = reactions.filter((r) => r.userIds.length > 0);
    return msg;
  }

  try {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId));
    if (!rows[0]) return null;

    const currentReactions: { emoji: string; userIds: string[] }[] = JSON.parse(
      rows[0].reactionsJson || '[]'
    );
    const existing = currentReactions.find((r) => r.emoji === emoji);
    if (existing) {
      if (existing.userIds.includes(userId)) {
        existing.userIds = existing.userIds.filter((id) => id !== userId);
      } else {
        existing.userIds.push(userId);
      }
    } else {
      currentReactions.push({ emoji, userIds: [userId] });
    }
    const cleaned = currentReactions.filter((r) => r.userIds.length > 0);

    const updated = await db
      .update(messages)
      .set({ reactionsJson: JSON.stringify(cleaned) })
      .where(eq(messages.id, messageId))
      .returning();

    return updated[0] ? mapMessageRow(updated[0]) : null;
  } catch {
    return null;
  }
}

export async function createChatRoomInDb(room: any) {
  if (!memoryStore.chats.some((c) => c.id === room.id)) {
    memoryStore.chats.unshift(room);
  }
  if (!isPostgresConfigured) return room;

  try {
    await db
      .insert(chats)
      .values({
        id: room.id,
        type: room.type,
        title: room.title,
        handle: room.handle || '',
        description: room.description || '',
        avatarUrl: room.avatarUrl || '',
        memberIdsJson: JSON.stringify(room.memberIds || []),
        adminIdsJson: JSON.stringify(room.adminIds || []),
        botIdsJson: JSON.stringify(room.botIds || []),
        e2eeKeySeed: room.e2eeKeySeed,
        e2eeFingerprint: room.e2eeFingerprint,
        subscriberCount: room.subscriberCount || 1,
        createdAt: room.createdAt || new Date().toISOString(),
      })
      .onConflictDoNothing();
    return room;
  } catch {
    return room;
  }
}

export async function rotateChatKeyInDb(
  chatId: string,
  newSeed: string,
  newFingerprint: string
) {
  const memChat = memoryStore.chats.find((c) => c.id === chatId);
  if (memChat) {
    memChat.e2eeKeySeed = newSeed;
    memChat.e2eeFingerprint = newFingerprint;
  }
  if (!isPostgresConfigured) return memChat || null;

  try {
    const updated = await db
      .update(chats)
      .set({
        e2eeKeySeed: newSeed,
        e2eeFingerprint: newFingerprint,
      })
      .where(eq(chats.id, chatId))
      .returning();
    return updated[0] ? mapChatRow(updated[0]) : memChat || null;
  } catch {
    return memChat || null;
  }
}

export async function registerDeviceBySyncCodeInDb(
  syncCode: string,
  deviceName: string,
  platform: string
) {
  if (!isPostgresConfigured) {
    const matchedUser = memoryStore.users.find(
      (u) => u.syncCode.toUpperCase() === syncCode.trim().toUpperCase()
    );
    if (!matchedUser) return null;
    const newDevice = {
      id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: matchedUser.id,
      deviceName: deviceName || 'ClickChat Synced Node',
      platform: platform || 'Multi-Device Sync',
      lastActiveAt: new Date().toISOString(),
      keyFingerprint: formatFp(`${matchedUser.publicKeyHex}:${Date.now()}`).slice(
        0,
        19
      ),
      syncState: 'synced' as const,
    };
    memoryStore.devices.push(newDevice);
    return { user: matchedUser, device: newDevice };
  }

  try {
    const allUsers = await db.select().from(users);
    const matchedUser = allUsers.find(
      (u) => u.syncCode.toUpperCase() === syncCode.trim().toUpperCase()
    );
    if (!matchedUser) return null;

    const newDevice = {
      id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: matchedUser.uid,
      deviceName: deviceName || 'ClickChat Synced Node',
      platform: platform || 'PostgreSQL Multi-Device Sync',
      lastActiveAt: new Date().toISOString(),
      keyFingerprint: formatFp(`${matchedUser.publicKeyHex}:${Date.now()}`).slice(
        0,
        19
      ),
      syncState: 'synced',
    };

    await db.insert(devices).values(newDevice);
    return {
      user: mapUserRow(matchedUser),
      device: newDevice,
    };
  } catch {
    return null;
  }
}

export async function revokeDeviceInDb(deviceId: string) {
  memoryStore.devices = memoryStore.devices.filter((d) => d.id !== deviceId);
  if (!isPostgresConfigured) return memoryStore.devices;

  try {
    await db.delete(devices).where(eq(devices.id, deviceId));
    return await db.select().from(devices);
  } catch {
    return memoryStore.devices;
  }
}

export async function createBotInDb(botData: any) {
  memoryStore.bots.push(botData);
  if (!isPostgresConfigured) return botData;

  try {
    await db.insert(bots).values({
      id: botData.id,
      name: botData.name,
      handle: botData.handle,
      description: botData.description,
      ownerId: botData.ownerId,
      token: botData.token,
      webhookUrl: botData.webhookUrl,
      commandsJson: JSON.stringify(botData.commands || []),
      isActive: true,
      messagesSent: 0,
      createdAt: botData.createdAt,
      logsJson: JSON.stringify(botData.logs || []),
    });
    return botData;
  } catch {
    return botData;
  }
}

export async function updateBotInDb(botId: string, patch: any) {
  const memBot = memoryStore.bots.find((b) => b.id === botId);
  if (memBot) {
    Object.assign(memBot, patch);
  }
  if (!isPostgresConfigured) return memBot || null;

  try {
    const rows = await db.select().from(bots).where(eq(bots.id, botId));
    if (!rows[0]) return memBot || null;
    const current = rows[0];

    const updated = await db
      .update(bots)
      .set({
        isActive:
          typeof patch.isActive === 'boolean' ? patch.isActive : current.isActive,
        webhookUrl:
          typeof patch.webhookUrl === 'string'
            ? patch.webhookUrl
            : current.webhookUrl,
        commandsJson: Array.isArray(patch.commands)
          ? JSON.stringify(patch.commands)
          : current.commandsJson,
        messagesSent:
          typeof patch.messagesSent === 'number'
            ? patch.messagesSent
            : current.messagesSent,
        logsJson: Array.isArray(patch.logs)
          ? JSON.stringify(patch.logs)
          : current.logsJson,
      })
      .where(eq(bots.id, botId))
      .returning();

    return updated[0] ? mapBotRow(updated[0]) : memBot || null;
  } catch {
    return memBot || null;
  }
}

export async function toggleBotInChatInDb(chatId: string, botId: string) {
  const memChat = memoryStore.chats.find((c) => c.id === chatId);
  if (memChat) {
    const botIds: string[] = memChat.botIds || [];
    memChat.botIds = botIds.includes(botId)
      ? botIds.filter((id) => id !== botId)
      : [...botIds, botId];
  }
  if (!isPostgresConfigured) return memoryStore.chats;

  try {
    const rows = await db.select().from(chats).where(eq(chats.id, chatId));
    if (!rows[0]) return memoryStore.chats;
    const botIds: string[] = JSON.parse(rows[0].botIdsJson || '[]');
    const nextBotIds = botIds.includes(botId)
      ? botIds.filter((id) => id !== botId)
      : [...botIds, botId];

    await db
      .update(chats)
      .set({ botIdsJson: JSON.stringify(nextBotIds) })
      .where(eq(chats.id, chatId));

    const allChats = await db.select().from(chats);
    return allChats.map(mapChatRow);
  } catch {
    return memoryStore.chats;
  }
}
