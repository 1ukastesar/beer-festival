import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, computeResults } from '../lib/db.js';

// GET /api/results → výsledky pro žebříček (display stránka polluje tohle)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();
  const results = await computeResults();
  // krátká cache, ať polling nezabíjí DB při mnoha divácích na /display
  // Cache na 10 s – display polluje po 30 s, takže typicky každý request
  // jde znovu na backend, ale když jich přijde víc najednou (např. víc TV),
  // Vercel jim během 10 s vrátí stejnou odpověď.
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
  res.json(results);
}
