import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, verifyPassword, currentPasswordHash, tokenFromHash, adminCookie } from '../../lib/db.js';

// POST /api/admin/login  body: {"password":"..."} -> sets the pivo_admin cookie
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  // The password may be stored in the DB (changed by the admin) -> we need the schema.
  await ensureSchema();

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const password: string = body?.password || '';

  if (!(await verifyPassword(password))) {
    return res.status(401).json({ error: 'špatné heslo' });
  }

  // We store a token (hash) in the cookie, not the password itself.
  res.setHeader('Set-Cookie', adminCookie(tokenFromHash(await currentPasswordHash())));
  res.json({ ok: true });
}
