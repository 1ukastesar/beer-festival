import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema } from '../../lib/db.js';

// POST /api/voter/register  body: {"voter":"<string>"}
//   Login-or-create: pokud jméno existuje, host se přes ně přihlásí.
//   Pokud neexistuje, vytvoří se nový záznam.
//   POZOR: bez hesla je to "známka", ne autentizace – kdo zná cizí jméno,
//   přihlásí se pod ním. Pro pivní akci s neformálními přezdívkami v pořádku.
//   Vrací:
//     201 {ok:true, created:true}  → nový voter
//     200 {ok:true, created:false} → přihlášení k existujícímu
//     400 {error:"..."}            → validační chyba
//
// GET  /api/voter/check?voter=<string>  → {exists: boolean}
//   Ověří, jestli string v DB existuje (pro auto-login při návratu).
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

  // INSERT ... ON CONFLICT DO NOTHING + zjištění, jestli se opravdu vložilo.
  // Vracíme různé status kódy podle toho.
  const result = (await sql`
    INSERT INTO voters (voter, created)
    VALUES (${voter}, ${Date.now()})
    ON CONFLICT (voter) DO NOTHING
    RETURNING voter
  `) as { voter: string }[];

  const created = result.length > 0;
  return res.status(created ? 201 : 200).json({ ok: true, created });
}
