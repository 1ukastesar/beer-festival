import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema } from '../lib/db.js';

// POST /api/vote  body: {"voter":"<id>","votes":[{"beer":"Plzeň","score":8,"note":"..."}]}
//   Upsert: smaže předchozí hlasy voteru a vloží nový set.
//   Pravidla:
//     - aktivní pivo: přijme se score + note (nový nebo aktualizovaný hlas)
//     - neaktivní pivo (sundané z čepu): host už ho dřív hodnotil; smí MĚNIT
//       jen note, score zůstává jak bylo (frontend posílá původní score zpátky,
//       ale pro jistotu si ho server načte z DB sám, ať to nejde obejít).
//
// GET  /api/vote?voter=<id>  → {beer: {score, note}} pro editaci
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (req.method === 'GET') {
    const voter = String(req.query.voter || '');
    const out: Record<string, { score: number; note: string; active: boolean }> = {};
    if (voter) {
      const rows = (await sql`
        SELECT v.beer, v.score, v.note, b.active
        FROM votes v
        JOIN beers b ON b.name = v.beer
        WHERE v.voter = ${voter}
      `) as { beer: string; score: number; note: string; active: boolean }[];
      for (const r of rows) {
        out[r.beer] = { score: r.score, note: r.note || '', active: r.active };
      }
    }
    return res.json(out);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const voter: string = body?.voter || '';
  const votes: { beer: string; score: number; note?: string }[] = body?.votes || [];

  if (!voter || voter.length > 64) {
    return res.status(400).json({ error: 'chybí nebo neplatné voter id' });
  }

  // Načteme stav piv (active flag) a předchozí hlasy voteru.
  const beersRows = (await sql`SELECT name, active FROM beers`) as { name: string; active: boolean }[];
  const beerState = new Map(beersRows.map((b) => [b.name, b.active]));

  const prevRows = (await sql`
    SELECT beer, score FROM votes WHERE voter = ${voter}
  `) as { beer: string; score: number }[];
  const prevScore = new Map(prevRows.map((p) => [p.beer, p.score]));

  // Validace a normalizace hlasů. Pro inactive piva přepíšeme score na to,
  // co host už dřív zadal (frontend score je tam jen informativně, ale
  // server si nedá vnutit změnu skóre po sundání z čepu).
  type CleanVote = { beer: string; score: number; note: string };
  const clean: CleanVote[] = [];

  for (const v of votes) {
    if (!beerState.has(v.beer)) {
      return res.status(400).json({ error: `neznámé pivo: ${v.beer}` });
    }
    const note = (v.note ?? '').toString().slice(0, 100);
    const isActive = beerState.get(v.beer);

    if (isActive) {
      // aktivní → score se přijme z requestu (1–10)
      if (!Number.isInteger(v.score) || v.score < 1 || v.score > 10) {
        return res.status(400).json({ error: `neplatné skóre pro ${v.beer}` });
      }
      clean.push({ beer: v.beer, score: v.score, note });
    } else {
      // neaktivní → musí mít předchozí hlas, jinak nelze hlasovat
      const prev = prevScore.get(v.beer);
      if (prev === undefined) {
        return res.status(400).json({
          error: `pivo ${v.beer} už není na čepu a předtím jsi ho neohodnotil`,
        });
      }
      // skóre vezmeme z DB, ne z requestu
      clean.push({ beer: v.beer, score: prev, note });
    }
  }

  // Upsert: smazat staré hlasy voteru, vložit nové (s notou).
  const now = Date.now();
  await sql`DELETE FROM votes WHERE voter = ${voter}`;
  for (const v of clean) {
    await sql`
      INSERT INTO votes (voter, beer, score, note, ts)
      VALUES (${voter}, ${v.beer}, ${v.score}, ${v.note}, ${now})
    `;
  }

  res.json({ ok: true });
}
