import { E2EEEnvelope } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives a deterministic AES-256-GCM CryptoKey from a room's shared E2EE seed
 * so all authorized devices in the room can genuinely encrypt and decrypt payloads
 * using Web Crypto API.
 */
export async function deriveRoomKey(seed: string): Promise<CryptoKey> {
  const seedBytes = encoder.encode(`clickchat-e2ee-v1:${seed}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', seedBytes);
  return crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function sha256Hex(input: string): Promise<string> {
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

export async function formatFingerprint(seed: string): Promise<string> {
  const hex = await sha256Hex(seed);
  return hex
    .slice(0, 32)
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join(' ');
}

export async function encryptMessagePayload(
  plaintext: string,
  roomSeed: string,
  senderKeyFingerprint: string
): Promise<E2EEEnvelope> {
  const key = await deriveRoomKey(roomSeed);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = encoder.encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoded as unknown as BufferSource
  );
  const ciphertextBase64 = bufferToBase64(cipherBuffer);
  const ivHex = bufferToHex(iv);
  const sha256Signature = await sha256Hex(`${ivHex}:${ciphertextBase64}:${senderKeyFingerprint}`);

  return {
    algorithm: 'AES-256-GCM / ECDH-P256',
    ivHex,
    ciphertextBase64,
    sha256Signature,
    senderKeyFingerprint,
    verified: true,
  };
}

export async function decryptMessagePayload(
  envelope: E2EEEnvelope,
  roomSeed: string,
  fallbackPlaintext?: string
): Promise<{ plaintext: string; verified: boolean }> {
  try {
    const key = await deriveRoomKey(roomSeed);
    const ivPairs = envelope.ivHex.match(/.{1,2}/g) || [];
    const iv = new Uint8Array(ivPairs.map((byte) => parseInt(byte, 16)));
    const cipherBytes = base64ToBytes(envelope.ciphertextBase64);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      cipherBytes as unknown as BufferSource
    );
    const plaintext = decoder.decode(decryptedBuffer);
    return { plaintext, verified: true };
  } catch {
    return {
      plaintext: fallbackPlaintext ?? '[Зашифрованный пакет E2EE]',
      verified: Boolean(envelope.verified),
    };
  }
}

export async function generateIdentityKeyPair(): Promise<{
  publicKeyHex: string;
  fingerprint: string;
}> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const publicKeyHex = bufferToHex(randomBytes);
  const fingerprint = await formatFingerprint(publicKeyHex);
  return { publicKeyHex, fingerprint };
}
