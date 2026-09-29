export type ChatType = 'direct' | 'group' | 'channel';

export interface UserProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  publicKeyFingerprint: string;
  publicKeyHex: string;
  status: 'online' | 'away' | 'offline';
  createdAt: string;
  syncCode: string;
}

export interface DeviceSession {
  id: string;
  userId: string;
  deviceName: string;
  platform: string;
  lastActiveAt: string;
  keyFingerprint: string;
  syncState: 'synced' | 'syncing';
}

export interface FileAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  dataUrl: string;
  encrypted: boolean;
  ivHex: string;
  sha256Hex: string;
}

export interface E2EEEnvelope {
  algorithm: 'AES-256-GCM / ECDH-P256';
  ivHex: string;
  ciphertextBase64: string;
  sha256Signature: string;
  senderKeyFingerprint: string;
  verified: boolean;
}

export interface MessageReaction {
  emoji: string;
  userIds: string[];
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderHandle: string;
  isBot?: boolean;
  text: string;
  createdAt: string;
  replyToId?: string;
  attachment?: FileAttachment;
  e2ee: E2EEEnvelope;
  views?: number;
  reactions: MessageReaction[];
}

export interface ChatRoom {
  id: string;
  type: ChatType;
  title: string;
  handle?: string;
  description: string;
  avatarUrl?: string;
  memberIds: string[];
  adminIds: string[];
  botIds: string[];
  e2eeKeySeed: string;
  e2eeFingerprint: string;
  createdAt: string;
  subscriberCount: number;
  pinnedMessageId?: string;
}

export interface BotCommand {
  command: string;
  description: string;
  responseTemplate: string;
}

export interface BotApiLog {
  id: string;
  timestamp: string;
  method: 'GET' | 'POST';
  endpoint: string;
  status: number;
  summary: string;
}

export interface BotApp {
  id: string;
  name: string;
  handle: string;
  description: string;
  ownerId: string;
  token: string;
  webhookUrl: string;
  commands: BotCommand[];
  isActive: boolean;
  messagesSent: number;
  createdAt: string;
  logs: BotApiLog[];
}

export interface CallState {
  active: boolean;
  callId: string;
  chatId: string;
  mode: 'audio' | 'video' | 'screen';
  initiatorId: string;
  initiatorName: string;
  status: 'ringing' | 'connected' | 'ended';
  startedAt?: number;
  isMuted: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  remotePeerConnected: boolean;
  encryptionSAS: string;
}
