# 🍺 Pivní slavnosti – Vercel + Neon Postgres

Live hlasování piv jako serverless aplikace na Vercelu s Neon Postgres.
Dostupné z internetu přes doménu, hosté hlasují přes mobilní data / WiFi.

> Tohle je **cloud verze**. Offline RPi+hotspot verze je samostatný projekt.
> Liší se: SQLite → Postgres, SSE → polling, Go server → TS serverless funkce.

```
[Telefon] --HTTPS--> [Vercel funkce /api/*] --> [Neon Postgres]
[TV /display] --poll 2.5s--> /api/results
```

## Co je uvnitř

| Část              | Technologie                          |
|-------------------|--------------------------------------|
| Backend           | TypeScript serverless funkce (/api)  |
| Databáze          | Neon Postgres (serverless)           |
| Realtime žebříček | polling /api/results po 2.5 s        |
| Frontend          | statické HTML v /public              |

## Endpointy

| Cesta                      | Popis                                        |
|----------------------------|----------------------------------------------|
| `GET /`                    | Hlasovací stránka (telefon)                  |
| `GET /display`             | Žebříček pro TV                              |
| `GET /admin`               | Správa piv (heslo)                          |
| `GET /api/beers`           | Aktivní piva pro hlasování                   |
| `GET /api/results`         | Výsledky (display polluje)                   |
| `POST /api/vote`           | Odeslat/přepsat hlasy voteru                 |
| `GET /api/vote?voter=<id>` | Dřívější hlasy telefonu (pro úpravu)         |
| `POST /api/admin/login`    | Přihlášení do adminu                        |
| `GET/POST /api/admin/beers`| Seznam / přidání / (de)aktivace piv          |

---

## Nasazení krok za krokem

### 1. Vytvoř Neon databázi

- Založ projekt na https://neon.tech (free tier stačí).
- Zkopíruj **connection string** (začíná `postgresql://...`).

### 2. Nahraj projekt na Vercel

Buď přes Git (push do repa, import na vercel.com), nebo přes CLI:

```bash
npm i -g vercel
vercel            # první nasazení (preview)
```

### 3. Nastav environment proměnné na Vercelu

V projektu na vercel.com → Settings → Environment Variables (nebo `vercel env add`):

```
DATABASE_URL    = postgresql://...    (z Neonu, krok 1)
ADMIN_PASSWORD  = tvoje-heslo         (změň default!)
```

> Pokud propojíš Neon přes Vercel integraci (Storage → Neon), `DATABASE_URL`
> se nastaví automaticky.

### 4. Produkční nasazení

```bash
vercel --prod
```

Dostaneš URL typu `https://pivo-xxx.vercel.app` (nebo vlastní doménu).

### 5. Přidej piva a spusť

- Otevři `https://<tvoje-url>/admin`, přihlas se heslem.
- Přidej piva, co máš na čepu.
- Na TV otevři `https://<tvoje-url>/display`.
- QR na stoly nech vést na `https://<tvoje-url>/`:
  ```bash
  qrencode -o qr.png 'https://<tvoje-url>/'
  ```

Schéma databáze se vytvoří samo při prvním požadavku (idempotentní
`CREATE TABLE IF NOT EXISTS`), nemusíš nic spouštět ručně.

---

## Lokální vývoj

```bash
npm install
echo "DATABASE_URL=postgresql://..." > .env.local
echo "ADMIN_PASSWORD=test" >> .env.local
vercel dev        # běží na http://localhost:3000
```

---

## Správa piv (admin)

Stejné jako RPi verze: `/admin` chráněné heslem (`ADMIN_PASSWORD`).
- **Přidat** → pivo se objeví hostům v hlasování.
- **Deaktivovat** (sundat z čepu) → zmizí z hlasování, zůstane v žebříčku.
- **Aktivovat** → zase k hodnocení.

Hosté vidí jen aktivní piva. Žebříček ukazuje všechna s aspoň jedním hlasem.

## Identita a úpravy hlasů

Telefon má stálé `voter` ID v `localStorage`. Hlasy jsou na něj navázané,
úprava je upsert (smaže staré, vloží nové → žádné duplikáty). Protože jde
o pravou HTTPS doménu otevřenou v plném prohlížeči, `localStorage` přežije
zavření i návrat – takže editace a opětovné otevření fungují (na rozdíl od
captive portálu u offline verze).

## Reset hlasování (nová akce)

Smaž data v Neonu (SQL konzole na neon.tech):

```sql
DELETE FROM votes;
-- volitelně i piva:
DELETE FROM beers;
```

## Poznámky k serverless

- **Polling místo SSE:** žebříček se obnovuje po 2.5 s. Pro pivní akci
  nepostřehnutelné, ale není to okamžitý push.
- **Cold start:** první požadavek po delší nečinnosti může být o ~1 s pomalejší
  (funkce se probouzí). Během akce s provozem se to neprojeví.
- **Neon free tier** může uspat DB při nečinnosti; první dotaz ji probudí.
  Pro celodenní akci s provozem zůstane vzhůru.
