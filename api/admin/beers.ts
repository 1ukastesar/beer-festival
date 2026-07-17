import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql, ensureSchema, isAdmin } from '../../lib/db.js';

// GET  /api/admin/beers -> all beers with their state (active) - admin only
// POST /api/admin/beers body: {"action":"add|activate|deactivate|activate_all|deactivate_all|delete|rename|import","name":"...","newName":"...","names":[...]}
//   rename uses newName; delete also removes that beer's votes; import takes a
//   names array (one beer per line from an uploaded file), additive;
//   activate_all/deactivate_all flip the active flag on every beer.
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

    // Import a list of beer names (one per line in the uploaded file). This is
    // additive: new names are inserted as active, names that already exist are
    // just re-activated. Handled before the single-name validation below.
    if (action === 'import') {
      const raw: unknown[] = Array.isArray(body?.names) ? body.names : [];
      const names = [
        ...new Set(
          raw.map((n) => String(n).trim()).filter((n) => n.length > 0 && n.length <= 80)
        ),
      ];
      if (names.length === 0) {
        return res.status(400).json({ error: 'soubor neobsahuje zadna platna jmena' });
      }
      const maxRow = (await sql`
        SELECT COALESCE(MAX(sort), 0) AS max FROM beers
      `) as { max: number | string }[];
      const baseSort = Number(maxRow[0]?.max ?? 0);
      const sorts = names.map((_, i) => baseSort + 1 + i);
      const now = Date.now();
      await sql`
        INSERT INTO beers (name, active, sort, created)
        SELECT n, true, s, ${now}
        FROM unnest(${names}::text[], ${sorts}::int[]) AS t(n, s)
        ON CONFLICT (name) DO UPDATE SET active = true
      `;
      const rows = (await sql`
        SELECT name, active FROM beers ORDER BY sort, name
      `) as { name: string; active: boolean }[];
      return res.json(rows);
    }

    // Bulk activate / deactivate every beer at once. No single name involved,
    // so handled before the name validation below.
    if (action === 'activate_all' || action === 'deactivate_all') {
      const active = action === 'activate_all';
      await sql`UPDATE beers SET active = ${active}`;
      const rows = (await sql`
        SELECT name, active FROM beers ORDER BY sort, name
      `) as { name: string; active: boolean }[];
      return res.json(rows);
    }

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
      case 'delete':
        // Remove the beer and its votes so a later beer with the same name
        // starts fresh instead of inheriting the old votes.
        await sql`DELETE FROM votes WHERE beer = ${name}`;
        await sql`DELETE FROM beers WHERE name = ${name}`;
        break;
      case 'rename': {
        const newName: string = (body?.newName || '').trim();
        if (!newName || newName.length > 80) {
          return res.status(400).json({ error: 'neplatné nové jméno piva' });
        }
        if (newName !== name) {
          const clash = (await sql`
            SELECT 1 FROM beers WHERE name = ${newName} LIMIT 1
          `) as { '?column?': number }[];
          if (clash.length > 0) {
            return res.status(409).json({ error: 'pivo s tímto jménem už existuje' });
          }
          // name is not a foreign key, so the votes have to be moved too.
          await sql`UPDATE beers SET name = ${newName} WHERE name = ${name}`;
          await sql`UPDATE votes SET beer = ${newName} WHERE beer = ${name}`;
        }
        break;
      }
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
