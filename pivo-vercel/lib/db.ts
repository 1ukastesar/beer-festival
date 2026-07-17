import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';

// Neon serverless client. Connection string from the DATABASE_URL env var
// (Vercel sets it automatically once linked to Neon, or set it manually).
export const sql = neon(process.env.DATABASE_URL!);

// Default admin password from env. Used only until the admin changes the
// password; after that the value stored in the DB wins (see currentPasswordHash).
export function defaultAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || 'pivo-admin';
}

// Password hash. Both in the DB and for comparison we keep only this hash,
// never the plaintext.
function hashPassword(pw: string): string {
  return createHash('sha256').update('pivo-pw|' + pw).digest('hex');
}

// Current password hash: the value stored in the DB wins (admin changed the
// password), otherwise we fall back to the default password from env.
export async function currentPasswordHash(): Promise<string> {
  const rows = (await sql`
    SELECT value FROM settings WHERE key = 'admin_pw_hash'
  `) as { value: string }[];
  return rows[0]?.value || hashPassword(defaultAdminPassword());
}

// Cookie token = SHA-256(password hash + salt). This way we never put the
// plaintext password in the cookie; anyone who sees the cookie does not get
// the password itself. When the password changes the token changes too ->
// the old cookie stops working (which is why we re-set the cookie right
// after a password change so the admin stays logged in).
export function tokenFromHash(hash: string): string {
  return createHash('sha256').update('pivo|' + hash).digest('hex');
}

// Verifies the given password against the current one (DB or env).
export async function verifyPassword(pw: string): Promise<boolean> {
  return timingSafeEqualHex(hashPassword(pw), await currentPasswordHash());
}

// Stores a new password (as a hash) in the DB. From now on the env password
// no longer applies.
export async function setAdminPassword(pw: string): Promise<void> {
  const hash = hashPassword(pw);
  await sql`
    INSERT INTO settings (key, value) VALUES ('admin_pw_hash', ${hash})
    ON CONFLICT (key) DO UPDATE SET value = ${hash}
  `;
}

// Set-Cookie header with the admin token (one place for both login and
// password change).
export function adminCookie(token: string): string {
  return `pivo_admin=${token}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`;
}

// Constant-time comparison of two hex strings, so the value cannot be guessed
// character by character from latency.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Lazy schema initialization - called at the start of every function.
// CREATE TABLE IF NOT EXISTS is idempotent, so repeated calls are harmless.
let initialized = false;
export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  // The CREATE statements are independent -> run them in parallel (saves cold start).
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
  // Migration + index only after the tables exist; independent of each other.
  await Promise.all([
    sql`ALTER TABLE votes ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`,
    sql`CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter)`,
  ]);
  initialized = true;
}

// Helper: verifies the admin cookie against the current password (DB or env).
export async function isAdmin(req: { headers: { cookie?: string } }): Promise<boolean> {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)pivo_admin=([^;]+)/);
  if (!m) return false;
  const got = decodeURIComponent(m[1]);
  const want = tokenFromHash(await currentPasswordHash());
  return timingSafeEqualHex(got, want);
}

// Helper: results (average + count) for all beers with at least one vote,
// plus active beers with no votes (so they show up in voting). Returns them sorted.
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
