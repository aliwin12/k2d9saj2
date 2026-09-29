import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthRequest extends Request {
  user?: DecodedIdToken | {
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

  const token = authHeader.split('Bearer ')[1];

  // Support portable ClickChat session tokens (used on Vercel / preview domains)
  if (token.startsWith('cc_session_')) {
    try {
      const encoded = token.slice('cc_session_'.length);
      const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      if (parsed && parsed.uid) {
        req.user = {
          uid: String(parsed.uid),
          email: parsed.email || `${parsed.uid}@clickchat.user`,
          name: parsed.name || 'Участник ClickChat',
          picture: parsed.picture || '',
        };
        return next();
      }
    } catch {
      return res.status(401).json({ error: 'Unauthorized: Invalid session token' });
    }
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
