import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureSchema, isAdmin, isVotingLocked, setVotingLocked } from '../../lib/db.js';

// GET  /api/admin/voting              -> {votingLocked} (admin only)
// POST /api/admin/voting {locked:bool} -> set lock, returns {votingLocked}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (!(await isAdmin(req))) {
    return res.status(401).json({ error: 'nepřihlášen' });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    await setVotingLocked(!!body?.locked);
  } else if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  res.json({ votingLocked: await isVotingLocked() });
}
