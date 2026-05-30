import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema } from '../lib/db.js';

// GET /api/beers → seznam aktivních piv (jména) pro hlasovací stránku
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();
  const rows = (await sql`
    SELECT name FROM beers WHERE active = true ORDER BY sort, name
  `) as { name: string }[];
  res.json(rows.map((r) => r.name));
}
