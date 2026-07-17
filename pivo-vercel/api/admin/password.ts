import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ensureSchema,
  isAdmin,
  verifyPassword,
  setAdminPassword,
  currentPasswordHash,
  tokenFromHash,
  adminCookie,
} from '../../lib/db.js';

// POST /api/admin/password  body: {"current":"...","next":"..."}
//   Verifies the current password, stores the new one (as a hash) in the DB
//   and re-sets the cookie with a new token so the admin stays logged in.
//   Protected by the admin cookie.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (!(await isAdmin(req))) {
    return res.status(401).json({ error: 'nepřihlášen' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const current: string = (body?.current || '').toString();
  const next: string = (body?.next || '').toString();

  if (!(await verifyPassword(current))) {
    return res.status(401).json({ error: 'špatné současné heslo' });
  }
  if (next.length < 4 || next.length > 128) {
    return res.status(400).json({ error: 'nové heslo musí mít 4–128 znaků' });
  }

  await setAdminPassword(next);

  // New password -> new token. Re-set the cookie so the admin stays logged in.
  res.setHeader('Set-Cookie', adminCookie(tokenFromHash(await currentPasswordHash())));
  res.json({ ok: true });
}
