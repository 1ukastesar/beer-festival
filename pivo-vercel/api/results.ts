import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, computeResults } from '../lib/db.js';

// GET /api/results → výsledky pro žebříček (display stránka polluje tohle)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();
  const results = await computeResults();
  // krátká cache, ať polling nezabíjí DB při mnoha divácích na /display
  res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate=2');
  res.json(results);
}
