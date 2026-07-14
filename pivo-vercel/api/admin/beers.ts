import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema, isAdmin } from '../../lib/db.js';

// GET  /api/admin/beers → všechna piva se stavem (active) – jen admin
// POST /api/admin/beers body: {"action":"add|activate|deactivate","name":"..."}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureSchema();

  if (!(await isAdmin(req))) {
    return res.status(401).json({ error: 'nepřihlášen' });
  }

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT name, active FROM beers ORDER BY sort, name
    `) as { name: string; active: boolean }[];
    return res.json(rows);
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const action: string = body?.action || '';
    const name: string = (body?.name || '').trim();

    if (!name || name.length > 80) {
      return res.status(400).json({ error: 'neplatné jméno piva' });
    }

    switch (action) {
case 'add': {
        try {
          const now = Date.now();
          console.log('[admin/beers] add: name=', name, 'now=', now);

          const maxRow = (await sql`
            SELECT COALESCE(MAX(sort), 0) AS max FROM beers
          `) as { max: number | string }[];
          console.log('[admin/beers] maxRow=', JSON.stringify(maxRow));

          const nextSort = Number(maxRow[0]?.max ?? 0) + 1;
          console.log('[admin/beers] nextSort=', nextSort, 'type=', typeof nextSort);

          await sql`
            INSERT INTO beers (name, active, sort, created)
            VALUES (${name}, true, ${nextSort}, ${now})
            ON CONFLICT (name) DO UPDATE SET active = true
          `;
          console.log('[admin/beers] insert OK');
        } catch (err) {
          console.error('[admin/beers] add ERROR:', err);
          throw err;
        }
        break;
      }
      case 'activate':
        await sql`UPDATE beers SET active = true WHERE name = ${name}`;
        break;
      case 'deactivate':
        await sql`UPDATE beers SET active = false WHERE name = ${name}`;
        break;
      default:
        return res.status(400).json({ error: 'neznámá akce' });
    }

    const rows = (await sql`
      SELECT name, active FROM beers ORDER BY sort, name
    `) as { name: string; active: boolean }[];
    return res.json(rows);
  }

  res.status(405).json({ error: 'method not allowed' });
}
