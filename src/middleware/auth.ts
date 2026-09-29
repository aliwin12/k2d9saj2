import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { DecodedIdToken } from 'firebase-admin/auth';

const TOKEN_SECRET =
  process.env.CLICKCHAT_JWT_SECRET ||
  process.env.SQL_PASSWORD ||
  'clickchat-production-hmac-sha256-secret-v1';

export interface ClickChatUserTokenPayload {
  uid: string;
  email: string;
  name: string;
  picture?: string;
  iat: number;
}

export function createSignedClickChatToken(payload: {
  uid: string;
  email: string;
  name: string;
  picture?: string;
}): string {
  const data: ClickChatUserTokenPayload = {
    uid: payload.uid,
    email: payload.email,
    name: payload.name,
    picture: payload.picture || '',
    iat: Date.now(),
  };
  const base64Payload = Buffer.from(JSON.stringify(data), 'utf8').toString(
    'base64url'
  );
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(base64Payload)
    .digest('base64url');
  return `cc_jwt_${base64Payload}.${signature}`;
}

export function verifySignedClickChatToken(
  token: string
): ClickChatUserTokenPayload | null {
  if (!token.startsWith('cc_jwt_')) return null;
  try {
    const raw = token.slice('cc_jwt_'.length);
    const [base64Payload, signature] = raw.split('.');
    if (!base64Payload || !signature) return null;
    const expectedSig = crypto
      .createHmac('sha256', TOKEN_SECRET)
      .update(base64Payload)
      .digest('base64url');
    if (signature !== expectedSig) return null;
    const parsed = JSON.parse(
      Buffer.from(base64Payload, 'base64url').toString('utf8')
    );
    if (!parsed || !parsed.uid || !parsed.email) return null;
    return parsed as ClickChatUserTokenPayload;
  } catch {
    return null;
  }
}

export interface AuthRequest extends Request {
  user?:
    | DecodedIdToken
    | {
        uid: string;
        email?: string;
        name?: string;
        picture?: string;
      };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split('Bearer ')[1].trim();

  // 1. Check first-party HMAC-SHA256 signed ClickChat JWT token (works on any domain including Vercel)
  const signedPayload = verifySignedClickChatToken(token);
  if (signedPayload) {
    req.user = {
      uid: signedPayload.uid,
      email: signedPayload.email,
      name: signedPayload.name,
      picture: signedPayload.picture || '',
    };
    return next();
  }

  // 2. Check Firebase ID token
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
