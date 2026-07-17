import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, computeResults } from '../lib/db.js';

// GET /api/results -> results for the ranking (the display page polls this)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();
  const results = await computeResults();
  // Short cache so polling does not hammer the DB when many viewers watch
  // /display. Cache for 10 s: the display polls every 30 s, so typically each
  // request hits the backend again, but when several arrive at once (e.g.
  // multiple TVs), Vercel serves them the same response within that 10 s.
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');
  res.json(results);
}
