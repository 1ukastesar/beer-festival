import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema, isVotingLocked } from '../lib/db.js';

// POST /api/vote  body: {"voter":"<id>","votes":[{"beer":"Plzen","score":8,"note":"..."}]}
//   Upsert: deletes the voter's previous votes and inserts the new set.
//   Rules:
//     - active beer: score + note are accepted (new or updated vote)
//     - inactive beer (taken off tap): the guest rated it earlier; they may
//       change only the note, the score stays as it was (the frontend sends
//       the original score back, but to be safe the server reads it from the
//       DB itself so it cannot be bypassed).
//
// GET  /api/vote?voter=<id>  -> {beer: {score, note}} for editing
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

  // Admin can lock voting; when locked no new or edited votes are accepted.
  if (await isVotingLocked()) {
    return res.status(423).json({ error: 'hlasování je uzamčeno' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const voter: string = body?.voter || '';
  const votes: { beer: string; score: number; note?: string }[] = body?.votes || [];

  if (!voter || voter.length > 64) {
    return res.status(400).json({ error: 'chybí nebo neplatné voter id' });
  }

  // Three independent queries in parallel: voter registration, beer state,
  // previous votes.
  const [voterCheck, beersRows, prevRows] = (await Promise.all([
    sql`SELECT 1 FROM voters WHERE voter = ${voter} LIMIT 1`,
    sql`SELECT name, active FROM beers`,
    sql`SELECT beer, score FROM votes WHERE voter = ${voter}`,
  ])) as [
    { '?column?': number }[],
    { name: string; active: boolean }[],
    { beer: string; score: number }[],
  ];

  if (voterCheck.length === 0) {
    return res.status(401).json({ error: 'nepřihlášen – zaregistruj se znovu' });
  }

  const beerState = new Map(beersRows.map((b) => [b.name, b.active]));
  const prevScore = new Map(prevRows.map((p) => [p.beer, p.score]));

  // Validate and normalize the votes. For inactive beers we overwrite the
  // score with what the guest entered earlier (the frontend score is only
  // informational there; the server will not let the score be changed once
  // the beer is off tap).
  //
  // A beer can disappear or go off tap between loading the form and submitting
  // it (admin deletes/deactivates it). We do not reject the whole batch for
  // that - we skip such beers and report them, so the rest of the votes still
  // save. Only a genuinely malformed score on a votable (active) beer is a
  // hard error.
  type CleanVote = { beer: string; score: number; note: string };
  const clean: CleanVote[] = [];
  const skipped: string[] = [];

  for (const v of votes) {
    // Unknown beer (deleted since the form loaded) -> skip.
    if (!beerState.has(v.beer)) {
      skipped.push(v.beer);
      continue;
    }
    const note = (v.note ?? '').toString().slice(0, 100);
    const isActive = beerState.get(v.beer);

    if (isActive) {
      // active -> the score is accepted from the request (1-10)
      if (!Number.isInteger(v.score) || v.score < 1 || v.score > 10) {
        return res.status(400).json({ error: `neplatné skóre pro ${v.beer}` });
      }
      clean.push({ beer: v.beer, score: v.score, note });
    } else {
      // inactive -> keep only if the guest had rated it before; otherwise the
      // beer went off tap before they ever scored it, so skip it.
      const prev = prevScore.get(v.beer);
      if (prev === undefined) {
        skipped.push(v.beer);
        continue;
      }
      // take the score from the DB, not from the request
      clean.push({ beer: v.beer, score: prev, note });
    }
  }

  // Upsert: delete the voter's old votes, insert the new ones in a single
  // multi-row INSERT (unnest instead of a loop = 1 query instead of N DB
  // round-trips).
  const now = Date.now();
  await sql`DELETE FROM votes WHERE voter = ${voter}`;
  if (clean.length > 0) {
    const beers = clean.map((v) => v.beer);
    const scores = clean.map((v) => v.score);
    const notes = clean.map((v) => v.note);
    await sql`
      INSERT INTO votes (voter, beer, score, note, ts)
      SELECT ${voter}, b, s, n, ${now}
      FROM unnest(${beers}::text[], ${scores}::int[], ${notes}::text[]) AS t(b, s, n)
    `;
  }

  res.json({ ok: true, skipped });
}
