import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema } from '../lib/db.js';

// POST /api/vote  body: {"voter":"<id>","votes":[{"beer":"Plzeň","score":8}]}
//   Upsert: smaže předchozí hlasy voteru a vloží nový set (žádné duplikáty).
// GET  /api/vote?voter=<id>  → dřívější hlasy daného telefonu {beer: score}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (req.method === 'GET') {
    const voter = String(req.query.voter || '');
    const out: Record<string, number> = {};
    if (voter) {
      const rows = (await sql`
        SELECT beer, score FROM votes WHERE voter = ${voter}
      `) as { beer: string; score: number }[];
      for (const r of rows) out[r.beer] = r.score;
    }
    return res.json(out);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const voter: string = body?.voter || '';
  const votes: { beer: string; score: number }[] = body?.votes || [];

  if (!voter || voter.length > 64) {
    return res.status(400).json({ error: 'chybí nebo neplatné voter id' });
  }

  // validace: pivo musí existovat a být aktivní, skóre 1–10
  const activeRows = (await sql`
    SELECT name FROM beers WHERE active = true
  `) as { name: string }[];
  const activeNames = new Set(activeRows.map((r) => r.name));
  for (const v of votes) {
    if (!activeNames.has(v.beer) || v.score < 1 || v.score > 10) {
      return res.status(400).json({ error: 'neplatné pivo nebo skóre' });
    }
  }

  // upsert: smazat staré hlasy voteru, vložit nové
  // (Neon HTTP driver nepodporuje multi-statement transakce v jednom tagu,
  //  ale tahle dvojice je idempotentní – poslední odeslání je pravda.)
  const now = Date.now();
  await sql`DELETE FROM votes WHERE voter = ${voter}`;
  for (const v of votes) {
    await sql`
      INSERT INTO votes (voter, beer, score, ts)
      VALUES (${voter}, ${v.beer}, ${v.score}, ${now})
    `;
  }

  res.json({ ok: true });
}
