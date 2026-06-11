import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema, isAdmin } from '../../lib/db.js';

// POST /api/admin/reset → smaže VŠECHNY hlasy a piva (reset pro novou akci).
// Votery nechává – hosté se nemusí znovu registrovat.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'nepřihlášen' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  await sql`DELETE FROM votes`;
  await sql`DELETE FROM beers`;

  return res.json({ ok: true });
}
