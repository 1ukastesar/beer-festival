import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';

// Neon serverless klient. Connection string z env DATABASE_URL
// (Vercel ho nastaví automaticky po propojení s Neon, nebo ho zadáš ručně).
export const sql = neon(process.env.DATABASE_URL!);

// Výchozí heslo k adminu z env. Slouží jen dokud si admin heslo nezmění –
// pak má přednost hodnota uložená v DB (viz currentPasswordHash).
export function defaultAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || 'pivo-admin';
}

// Hash hesla. V DB i pro porovnání držíme jen tenhle hash, ne plaintext.
function hashPassword(pw: string): string {
  return createHash('sha256').update('pivo-pw|' + pw).digest('hex');
}

// Aktuální hash hesla: přednost má hodnota uložená v DB (admin si heslo
// změnil), jinak spadneme na výchozí heslo z env.
export async function currentPasswordHash(): Promise<string> {
  const rows = (await sql`
    SELECT value FROM settings WHERE key = 'admin_pw_hash'
  `) as { value: string }[];
  return rows[0]?.value || hashPassword(defaultAdminPassword());
}

// Token do cookie = SHA-256(hash hesla + sůl). Do cookie tak nedáváme heslo
// v plaintextu; kdo zahlédne cookie, nezíská heslo samotné. Když se heslo
// změní, změní se i token → staré cookie přestane platit (proto po změně
// hesla cookie hned přenastavujeme, ať admin zůstane přihlášený).
export function tokenFromHash(hash: string): string {
  return createHash('sha256').update('pivo|' + hash).digest('hex');
}

// Ověří zadané heslo proti aktuálnímu (DB nebo env).
export async function verifyPassword(pw: string): Promise<boolean> {
  return timingSafeEqualHex(hashPassword(pw), await currentPasswordHash());
}

// Uloží nové heslo (jako hash) do DB. Od téhle chvíle env heslo neplatí.
export async function setAdminPassword(pw: string): Promise<void> {
  const hash = hashPassword(pw);
  await sql`
    INSERT INTO settings (key, value) VALUES ('admin_pw_hash', ${hash})
    ON CONFLICT (key) DO UPDATE SET value = ${hash}
  `;
}

// Hlavička Set-Cookie s admin tokenem (jedno místo pro login i změnu hesla).
export function adminCookie(token: string): string {
  return `pivo_admin=${token}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`;
}

// Porovnání dvou hex řetězců v konstantním čase – ať se hodnota nedá
// uhádnout po znacích podle latence.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Lazy inicializace schématu – zavolá se na začátku každé funkce.
// CREATE TABLE IF NOT EXISTS je idempotentní, takže opakované volání nevadí.
let initialized = false;
export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  // CREATE tabulek jsou nezávislé → paralelně (šetří cold start).
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
    sql`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ]);
  // Migrace + index až po existenci tabulek; navzájem nezávislé.
  await Promise.all([
    sql`ALTER TABLE votes ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`,
    sql`CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter)`,
  ]);
  initialized = true;
}

// Pomocník: ověří admin cookie proti aktuálnímu heslu (DB nebo env).
export async function isAdmin(req: { headers: { cookie?: string } }): Promise<boolean> {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)pivo_admin=([^;]+)/);
  if (!m) return false;
  const got = decodeURIComponent(m[1]);
  const want = tokenFromHash(await currentPasswordHash());
  return timingSafeEqualHex(got, want);
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
