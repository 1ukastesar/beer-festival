import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema } from '../../lib/db.js';

// POST /api/voter/register  body: {"voter":"<string>"}
//   Login-or-create: if the name exists, the guest logs in with it.
//   If it does not exist, a new record is created.
//   NOTE: without a password this is a "name tag", not authentication -
//   anyone who knows another name can log in as them. Fine for a beer event
//   with informal nicknames.
//   Returns:
//     201 {ok:true, created:true}  -> new voter
//     200 {ok:true, created:false} -> login to an existing one
//     400 {error:"..."}            -> validation error
//
// GET  /api/voter/check?voter=<string>  -> {exists: boolean}
//   Checks whether the string exists in the DB (for auto-login on return).
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

  // Protection against flooding the DB (free tier). Cap voters at a sensible
  // maximum for a beer event. An existing voter (login) does not count - we
  // check only when creating a new one. The check runs only when the name is
  // not in the DB yet.
  const VOTER_CAP = 2000;
  const existing = (await sql`
    SELECT 1 FROM voters WHERE voter = ${voter} LIMIT 1
  `) as { '?column?': number }[];
  if (existing.length === 0) {
    const cnt = (await sql`SELECT COUNT(*)::int AS n FROM voters`) as { n: number }[];
    if ((cnt[0]?.n ?? 0) >= VOTER_CAP) {
      return res.status(429).json({ error: 'kapacita hlasujících je plná' });
    }
  }

  // INSERT ... ON CONFLICT DO NOTHING, plus find out whether a row was really
  // inserted. We return different status codes based on that.
  const result = (await sql`
    INSERT INTO voters (voter, created)
    VALUES (${voter}, ${Date.now()})
    ON CONFLICT (voter) DO NOTHING
    RETURNING voter
  `) as { voter: string }[];

  const created = result.length > 0;
  return res.status(created ? 201 : 200).json({ ok: true, created });
}
