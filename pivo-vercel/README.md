# 🍺 BeerMeter

Live beer rating app. Guests rate beers from their phones, results show on a TV leaderboard in real time. Built as a serverless app on Vercel with Neon Postgres.

```
[Phone] --HTTPS--> [Vercel /api/*] --> [Neon Postgres]
[TV /display] --poll every 2.5s--> /api/results
```

## Stack

| Layer        | Technology                          |
|--------------|-------------------------------------|
| Backend      | TypeScript serverless functions     |
| Database     | Neon Postgres (serverless)          |
| Leaderboard  | Polling `/api/results` every 2.5s   |
| Frontend     | Static HTML in `/public`            |

## Endpoints

| Path                          | Description                                  |
|-------------------------------|----------------------------------------------|
| `GET /`                       | Voting page (phones)                         |
| `GET /display`                | Live leaderboard (TV)                        |
| `GET /admin`                  | Beer management (password-protected)         |
| `GET /api/beers`              | Active beers for voting                      |
| `GET /api/results`            | Results (polled by /display)                 |
| `POST /api/vote`              | Submit/overwrite a voter's ratings           |
| `GET /api/vote?voter=<id>`    | Voter's previous ratings (for editing)       |
| `POST /api/admin/login`       | Admin login                                  |
| `GET/POST /api/admin/beers`   | List / add / (de)activate beers              |

## Deployment

### 1. Create a Neon database

- Sign up at [neon.tech](https://neon.tech) (free tier is enough).
- Copy the **connection string** (starts with `postgresql://...`).

### 2. Deploy to Vercel

Import this repository on [vercel.com/new](https://vercel.com/new). Vercel auto-detects the serverless functions in `/api` and static files in `/public`.

### 3. Set environment variables

In the Vercel project: **Settings → Environment Variables**:

```
DATABASE_URL    = postgresql://...    (from Neon)
ADMIN_PASSWORD  = your-password       (change from default!)
```

> If you connect Neon via the Vercel integration (**Storage → Neon**), `DATABASE_URL` is set automatically.

### 4. Deploy

Push to `main` triggers a production deploy. You'll get a URL like `https://beermeter-xxx.vercel.app`.

### 5. Add beers and run the event

- Open `https://<your-url>/admin`, sign in with `ADMIN_PASSWORD`.
- Add beers currently on tap.
- Open `https://<your-url>/display` on the TV.
- Generate a QR code linking to `https://<your-url>/` and place it on the tables.

The database schema is created automatically on first request (idempotent `CREATE TABLE IF NOT EXISTS`).

## Managing beers during the event

Open `/admin` (password from `ADMIN_PASSWORD`):

- **Add** — the beer appears in voting.
- **Deactivate** (taken off tap) — hidden from voting, stays on the leaderboard with its score so far.
- **Activate** — brought back to voting; previous votes are preserved.

Guests only see active beers. The leaderboard shows every beer that received at least one vote.

## Voter identity and editing

Each phone gets a persistent `voter` ID stored in `localStorage`. Votes are tied to that ID. Editing is an **upsert** — submitting again deletes the voter's previous ratings and inserts the new set, so the vote count never grows from edits, only the average updates.

Because the app runs on a real HTTPS domain in the full browser, `localStorage` persists across closing and reopening the page, so editing and revisiting work reliably.

## Reset for a new event

In the Neon SQL console:

```sql
DELETE FROM votes;
-- and optionally:
DELETE FROM beers;
```

## Notes

- **Polling, not push.** The leaderboard refreshes every 2.5 s. Imperceptible during an event, but not an instant push.
- **Cold starts.** First request after idle time may be ~1 s slower while functions and the database warm up. Not noticeable under continuous traffic.
- **Neon free tier** may pause the database when idle; the first query wakes it up.

## License

MIT