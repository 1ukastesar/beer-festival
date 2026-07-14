import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, verifyPassword, currentPasswordHash, tokenFromHash, adminCookie } from '../../lib/db.js';

// POST /api/admin/login  body: {"password":"..."} → nastaví cookie pivo_admin
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  // Heslo může být uložené v DB (změněné adminem) → potřebujeme schéma.
  await ensureSchema();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const password: string = body?.password || '';

  if (!(await verifyPassword(password))) {
    return res.status(401).json({ error: 'špatné heslo' });
  }

  // Do cookie ukládáme token (hash), ne heslo samotné.
  res.setHeader('Set-Cookie', adminCookie(tokenFromHash(await currentPasswordHash())));
  res.json({ ok: true });
}
