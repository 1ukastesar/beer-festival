import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, isVotingLocked } from '../lib/db.js';

// GET /api/status -> public voting status for the guest page.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ votingLocked: await isVotingLocked() });
}
