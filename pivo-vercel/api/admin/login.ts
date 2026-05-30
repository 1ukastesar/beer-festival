import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminPassword } from '../../lib/db.js';

// POST /api/admin/login  body: {"password":"..."} → nastaví cookie pivo_admin
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const password: string = body?.password || '';

  if (password !== adminPassword()) {
    return res.status(401).json({ error: 'špatné heslo' });
  }

  // Secure cookie – Vercel je vždy HTTPS, takže Secure je v pořádku.
  res.setHeader(
    'Set-Cookie',
    `pivo_admin=${encodeURIComponent(password)}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`
  );
  res.json({ ok: true });
}
