import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  handle: text('handle').notNull(),
  displayName: text('display_name').notNull(),
  bio: text('bio').notNull(),
  avatarUrl: text('avatar_url').notNull().default(''),
  publicKeyHex: text('public_key_hex').notNull(),
  publicKeyFingerprint: text('public_key_fingerprint').notNull(),
  status: text('status').notNull().default('online'),
  syncCode: text('sync_code').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  deviceName: text('device_name').notNull(),
  platform: text('platform').notNull(),
  lastActiveAt: text('last_active_at').notNull(),
  keyFingerprint: text('key_fingerprint').notNull(),
  syncState: text('sync_state').notNull().default('synced'),
});

export const chats = pgTable('chats', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  handle: text('handle').notNull().default(''),
  description: text('description').notNull(),
  avatarUrl: text('avatar_url').notNull().default(''),
  memberIdsJson: text('member_ids_json').notNull(),
  adminIdsJson: text('admin_ids_json').notNull(),
  botIdsJson: text('bot_ids_json').notNull(),
  e2eeKeySeed: text('e2ee_key_seed').notNull(),
  e2eeFingerprint: text('e2ee_fingerprint').notNull(),
  subscriberCount: integer('subscriber_count').notNull().default(1),
  createdAt: text('created_at').notNull(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  senderId: text('sender_id').notNull(),
  senderName: text('sender_name').notNull(),
  senderHandle: text('sender_handle').notNull(),
  isBot: boolean('is_bot').notNull().default(false),
  text: text('text').notNull(),
  createdAt: text('created_at').notNull(),
  replyToId: text('reply_to_id'),
  attachmentJson: text('attachment_json'),
  e2eeJson: text('e2ee_json').notNull(),
  views: integer('views'),
  reactionsJson: text('reactions_json').notNull(),
});

export const bots = pgTable('bots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  handle: text('handle').notNull(),
  description: text('description').notNull(),
  ownerId: text('owner_id').notNull(),
  token: text('token').notNull().unique(),
  webhookUrl: text('webhook_url').notNull(),
  commandsJson: text('commands_json').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  messagesSent: integer('messages_sent').notNull().default(0),
  createdAt: text('created_at').notNull(),
  logsJson: text('logs_json').notNull(),
});
