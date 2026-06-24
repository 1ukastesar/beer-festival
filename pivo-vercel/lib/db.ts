import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';

// Neon serverless klient. Connection string z env DATABASE_URL
// (Vercel ho nastaví automaticky po propojení s Neon, nebo ho zadáš ručně).
export const sql = neon(process.env.DATABASE_URL!);

// Heslo k adminu z env. Změň v nastavení projektu na Vercelu!
export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || 'pivo-admin';
}

// Token do cookie = SHA-256(heslo + sůl). Do cookie tak nedáváme heslo
// v plaintextu; kdo zahlédne cookie, nezíská heslo samotné. Sůl odděluje
// tento token od prostého hashe hesla.
export function adminToken(): string {
  return createHash('sha256').update('pivo|' + adminPassword()).digest('hex');
}

// Lazy inicializace schématu – zavolá se na začátku každé funkce.
// CREATE TABLE IF NOT EXISTS je idempotentní, takže opakované volání nevadí.
let initialized = false;
export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  // Tři CREATE jsou nezávislé → paralelně (šetří cold start).
  await Promise.all([
    sql`
    CREATE TABLE IF NOT EXISTS beers (
      name    TEXT PRIMARY KEY,
      active  BOOLEAN NOT NULL DEFAULT true,
      sort    INTEGER NOT NULL DEFAULT 0,
      created BIGINT  NOT NULL
    )`,
    sql`
    CREATE TABLE IF NOT EXISTS voters (
      voter   TEXT PRIMARY KEY,
      created BIGINT NOT NULL
    )`,
    sql`
    CREATE TABLE IF NOT EXISTS votes (
      id      BIGSERIAL PRIMARY KEY,
      voter   TEXT NOT NULL,
      beer    TEXT NOT NULL,
      score   INTEGER NOT NULL,
      note    TEXT NOT NULL DEFAULT '',
      ts      BIGINT NOT NULL
    )`,
  ]);
  // Migrace + index až po existenci tabulek; navzájem nezávislé.
  await Promise.all([
    sql`ALTER TABLE votes ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`,
    sql`CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter)`,
  ]);
  initialized = true;
}

// Pomocník: ověří admin cookie proti heslu.
export function isAdmin(req: { headers: { cookie?: string } }): boolean {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)pivo_admin=([^;]+)/);
  if (!m) return false;
  const got = decodeURIComponent(m[1]);
  const want = adminToken();
  // konstantní čas – ať se token nedá uhádnout po znacích podle latence
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

// Pomocník: výsledky (průměr + počet) pro všechna piva s aspoň jedním hlasem,
// plus aktivní piva bez hlasů (ať jsou vidět v hlasování). Vrací seřazené.
export async function computeResults(): Promise<
  { beer: string; avg: number; count: number; active: boolean }[]
> {
  const rows = (await sql`
    SELECT b.name AS beer,
           b.active AS active,
           COALESCE(AVG(v.score), 0) AS avg,
           COUNT(v.id) AS count
    FROM beers b
    LEFT JOIN votes v ON v.beer = b.name
    GROUP BY b.name, b.active, b.sort
    ORDER BY avg DESC, b.sort, b.name
  `) as { beer: string; active: boolean; avg: string; count: string }[];
  return rows.map((r) => ({
    beer: r.beer,
    active: r.active,
    avg: Number(r.avg),
    count: Number(r.count),
  }));
}
