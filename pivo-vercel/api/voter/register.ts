import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema } from '../../lib/db.js';

// POST /api/voter/register  body: {"voter":"<string>"}
//   Vytvoří nový voter záznam. Vrací:
//     201 {ok:true}      → registrace prošla
//     409 {error:"obsazený"} → tenhle string už existuje
//     400 {error:"..."}  → validační chyba
//
// GET  /api/voter/check?voter=<string>  → {exists: boolean}
//   Ověří, jestli string v DB existuje (pro auto-login).
//   Frontend si pamatuje voter v localStorage; při startu si ověří,
//   že v DB pořád existuje (mohla se mezitím vymazat).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (req.method === 'GET') {
    const voter = String(req.query.voter || '').trim();
    if (!voter) return res.json({ exists: false });
    const rows = (await sql`
      SELECT 1 FROM voters WHERE voter = ${voter} LIMIT 1
    `) as { '?column?': number }[];
    return res.json({ exists: rows.length > 0 });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const voter: string = (body?.voter || '').toString().trim();

  if (!voter) {
    return res.status(400).json({ error: 'zadej svoje jméno' });
  }
  if (voter.length < 2 || voter.length > 32) {
    return res.status(400).json({ error: 'jméno musí mít 2–32 znaků' });
  }

  // Pokus o INSERT; konflikt na PRIMARY KEY znamená, že už je obsazené.
  try {
    await sql`
      INSERT INTO voters (voter, created)
      VALUES (${voter}, ${Date.now()})
    `;
    return res.status(201).json({ ok: true });
  } catch (err: unknown) {
    // Postgres unique violation = SQLSTATE 23505
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate key') || msg.includes('23505')) {
      return res.status(409).json({ error: 'tohle jméno už někdo má, zkus jiné' });
    }
    throw err;
  }
}
