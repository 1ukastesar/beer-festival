import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema, isAdmin } from '../../lib/db.js';

// GET  /api/admin/voters -> all voters with their vote count - admin only
// POST /api/admin/voters body: {"action":"rename|kick","voter":"...","newName":"..."}
//   kick removes the voter and all their votes; rename moves the votes too.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (!(await isAdmin(req))) {
    return res.status(401).json({ error: 'nepřihlášen' });
  }

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT v.voter AS voter, COUNT(vo.id)::int AS votes
      FROM voters v
      LEFT JOIN votes vo ON vo.voter = v.voter
      GROUP BY v.voter
      ORDER BY v.voter
    `) as { voter: string; votes: number }[];
    return res.json(rows);
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const action: string = body?.action || '';
    const voter: string = (body?.voter || '').toString().trim();

    if (!voter) {
      return res.status(400).json({ error: 'neplatné jméno hlasujícího' });
    }

    switch (action) {
      case 'kick':
        // Remove the voter and their votes.
        await sql`DELETE FROM votes WHERE voter = ${voter}`;
        await sql`DELETE FROM voters WHERE voter = ${voter}`;
        break;
      case 'rename': {
        const newName: string = (body?.newName || '').toString().trim();
        if (newName.length < 2 || newName.length > 32) {
          return res.status(400).json({ error: 'jméno musí mít 2–32 znaků' });
        }
        if (newName !== voter) {
          const clash = (await sql`
            SELECT 1 FROM voters WHERE voter = ${newName} LIMIT 1
          `) as { '?column?': number }[];
          if (clash.length > 0) {
            return res.status(409).json({ error: 'hlasující s tímto jménem už existuje' });
          }
          // voter is not a foreign key, so the votes have to be moved too.
          await sql`UPDATE voters SET voter = ${newName} WHERE voter = ${voter}`;
          await sql`UPDATE votes SET voter = ${newName} WHERE voter = ${voter}`;
        }
        break;
      }
      default:
        return res.status(400).json({ error: 'neznámá akce' });
    }

    const rows = (await sql`
      SELECT v.voter AS voter, COUNT(vo.id)::int AS votes
      FROM voters v
      LEFT JOIN votes vo ON vo.voter = v.voter
      GROUP BY v.voter
      ORDER BY v.voter
    `) as { voter: string; votes: number }[];
    return res.json(rows);
  }

  res.status(405).json({ error: 'method not allowed' });
}
