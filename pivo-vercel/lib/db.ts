import { neon } from '@neondatabase/serverless';

// Neon serverless klient. Connection string z env DATABASE_URL
// (Vercel ho nastaví automaticky po propojení s Neon, nebo ho zadáš ručně).
export const sql = neon(process.env.DATABASE_URL!);

// Heslo k adminu z env. Změň v nastavení projektu na Vercelu!
export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || 'pivo-admin';
}

// Lazy inicializace schématu – zavolá se na začátku každé funkce.
// CREATE TABLE IF NOT EXISTS je idempotentní, takže opakované volání nevadí.
let initialized = false;
export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  await sql`
    CREATE TABLE IF NOT EXISTS beers (
      name    TEXT PRIMARY KEY,
      active  BOOLEAN NOT NULL DEFAULT true,
      sort    INTEGER NOT NULL DEFAULT 0,
      created BIGINT  NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS votes (
      id      BIGSERIAL PRIMARY KEY,
      voter   TEXT NOT NULL,
      beer    TEXT NOT NULL,
      score   INTEGER NOT NULL,
      note    TEXT NOT NULL DEFAULT '',
      ts      BIGINT NOT NULL
    )`;
  // Pro existující DB ze starší verze schématu doplníme nový sloupec.
  // IF NOT EXISTS dělá příkaz idempotentním.
  await sql`ALTER TABLE votes ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter)`;
  initialized = true;
}

// Pomocník: ověří admin cookie proti heslu.
export function isAdmin(req: { headers: { cookie?: string } }): boolean {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)pivo_admin=([^;]+)/);
  return !!m && decodeURIComponent(m[1]) === adminPassword();
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
