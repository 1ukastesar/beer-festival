import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema, isAdmin } from '../../lib/db.js';

// POST /api/admin/reset → reset dat (chráněno admin cookie).
//   body {"scope":"data"}   (default) → smaže všechny hlasy a piva
//   body {"scope":"voters"}           → smaže všechny uživatele (přihlašovací jména)
// Pozn.: smazání uživatelů nechává hlasy – žebříček zůstává. Když se někdo
// zaregistruje znovu pod stejným jménem, svoje staré hlasy „zdědí".
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (!(await isAdmin(req))) {
    return res.status(401).json({ error: 'nepřihlášen' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const scope: string = body?.scope || 'data';

  if (scope === 'voters') {
    await sql`DELETE FROM voters`;
  } else {
    await sql`DELETE FROM votes`;
    await sql`DELETE FROM beers`;
  }

  return res.json({ ok: true, scope });
}
