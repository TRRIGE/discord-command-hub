# Discord Slash-Command Bot + Dashboard

A small but real product: an admin connects a Discord server, users run slash
commands (`/report`, `/status`), and every interaction is verified, recorded,
acted on by a configurable rule, replied to in Discord, and **mirrored to a
second channel** (Slack or another Discord channel). A login-gated dashboard
shows a live command log, the actions taken, downstream failures, and lets the
admin configure command behavior.

Built to run **unattended**: it verifies Discord's Ed25519 signature on every
request, dedups replayed interactions, defers slow work to stay inside the ~3s
window, retries downstream calls with an outbox, and never puts secrets in the
repo, the client, or the logs.

---

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| App + API + dashboard | **Next.js 15 (App Router), TypeScript** | One deployable unit; the interactions endpoint, dashboard, and its APIs live together. |
| Hosting | **Vercel** (free, no card) | Fast cold starts matter for Discord's 3s window; `after()` is backed by `waitUntil` for post-response work. |
| Database | **Neon / Supabase Postgres** + Prisma | Free Postgres, no card. |
| Signature verify | **tweetnacl** | Ed25519, no native deps. |
| Sessions | **jose** JWT in an httpOnly cookie | Edge-safe (middleware); scrypt password hashing kept Node-only. |
| Mirror | Slack Incoming Webhook **or** Discord webhook | Both are paste-a-URL, no card. |
| AI (optional) | **Google Gemini** (AI Studio, free) | Triage/summarize report text. |

---

## What it does (mapped to the brief)

**Core**
- ✅ Publicly reachable web app (the interactions endpoint can't be localhost).
- ✅ Discord app/bot with **two** slash commands: `/report`, `/status`.
- ✅ Interactions endpoint that handles commands and **records** them.
- ✅ Writes back in Discord (a reply, plus a channel post for flagged reports).
- ✅ Mirrors a notification to a **second channel** (Slack or Discord webhook).
- ✅ Dashboard behind login: live command log, actions taken, command config.
- ✅ This README + `.env.example` (no real secrets).

**Stretch (implemented)**
- ✅ **Configurable rules in the UI** — keyword→tag rule, reply template, and toggles per command, not hard-coded.
- ✅ **Interactive components** — `Acknowledge` / `Escalate` buttons on a report (a second, separately-verified interaction type). Escalate mirrors an alert.
- ✅ **Modal form** — `/report` with no text opens a dialog; the submit is handled as its own interaction type.
- ✅ **AI step** — optional Gemini triage produces a summary + tags shown in the Discord reply and the dashboard.
- ✅ **Multi-server** — each connected guild is an isolated row with its own channel, mirror, and per-command config.
- ✅ **Observability** — structured JSON logs, an outbox with attempts/last-error, a failures panel with one-click retry, and a cron sweep that reclaims stranded actions.

---

## The reliability model (the interesting part)

- **Signature verification** (`src/lib/discord/verify.ts`) runs on *every* POST
  using the raw request body. Forged, unsigned, tampered-body, and
  tampered-timestamp requests all get `401`. (Unit-tested; see below.)
- **Dedup** — `InteractionLog.interactionId` is unique. A redelivered
  interaction hits the constraint and replays the stored response instead of
  running side effects twice.
- **3-second window** — fast commands reply immediately (type 4). Slow work
  (AI) replies with a **deferred** ack (type 5); the real message is patched in
  afterwards via the interaction webhook, run in `after()` so it never blocks
  the response.
- **Outbox** — every side effect (mirror, deferred followup) is an `Action`
  row. It's retried with exponential backoff; the final outcome
  (`SUCCESS`/`FAILED` + `lastError` + `attempts`) is persisted, surfaced in the
  dashboard, and retryable. A **cron sweep** (`/api/cron/sweep`, every 5 min)
  re-runs anything failed or stranded, so a crash mid-flight loses nothing.
- **Secrets** — the mirror webhook URL lives only on the `Server` row; it is
  never snapshotted into the outbox and never sent to the browser (the
  dashboard only receives a `hasMirrorWebhook` boolean). Bot token / public key
  / DB URL are env-only.

---

## Run it locally

### 0. Prerequisites
- Node 18.18+ (or 20+), a Postgres database (Neon free tier is easiest).

### 1. Install + configure
```bash
npm install
cp .env.example .env
# fill in .env — see the variable table below
```

### 2. Database
```bash
npx prisma db push      # create tables
npm run seed-admin      # create the dashboard admin from ADMIN_EMAIL/ADMIN_PASSWORD
```

### 3. Register the slash commands with Discord
```bash
# set DISCORD_TEST_GUILD_ID in .env for instant (per-guild) registration,
# or leave it blank for global (can take up to ~1h to appear)
npm run register-commands
```

### 4. Run
```bash
npm run dev             # http://localhost:3000  -> redirects to /login
```

Discord can't call `localhost`. To test the live endpoint locally, expose it
with a tunnel (e.g. `npx localtunnel --port 3000` or `cloudflared tunnel`) and
put that HTTPS URL in the Developer Portal (next section).

### Useful scripts
```bash
npm run typecheck       # tsc --noEmit
npm test                # vitest: signature verification + rule engine
npm run build           # prisma generate + next build
```

---

## Environment variables

| Var | Required | What |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Postgres connection string (Neon/Supabase). |
| `DISCORD_APPLICATION_ID` | ✅ | Portal → General Information → Application ID. |
| `DISCORD_PUBLIC_KEY` | ✅ | Portal → General Information → Public Key (verifies signatures). |
| `DISCORD_BOT_TOKEN` | ✅ | Portal → Bot → Token (server-side only). |
| `AUTH_SECRET` | ✅ | Signs the session JWT. `openssl rand -base64 48`. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✅ | Seeded dashboard login. |
| `GEMINI_API_KEY` | ⬜ | Enables AI triage. Blank = feature off. |
| `GEMINI_MODEL` | ⬜ | Default `gemini-1.5-flash`. |
| `CRON_SECRET` | ⬜ | Guards `/api/cron/sweep` (Vercel Cron sends it automatically). |
| `DISCORD_TEST_GUILD_ID` | ⬜ | Register commands to one guild for instant testing. |
| `APP_BASE_URL` | ⬜ | Your deployed origin. |

A full, secret-free template is in [`.env.example`](./.env.example).

---

## Set up the Discord app (free, no card)

1. **Create the app** — <https://discord.com/developers/applications> → *New
   Application*. Copy the **Application ID** and **Public Key** into `.env`.
2. **Add a bot** — *Bot* tab → *Reset Token* → copy into `DISCORD_BOT_TOKEN`.
3. **Invite it to your server** — *OAuth2 → URL Generator* → scopes
   `bot` + `applications.commands`, bot permission *Send Messages*. Open the
   generated URL and add it to a server you own.
4. **Register commands** — `npm run register-commands`.
5. **Set the interactions endpoint** — deploy first (below), then *General
   Information → Interactions Endpoint URL* =
   `https://<your-app>.vercel.app/api/interactions`. Discord sends a signed
   PING; the endpoint answers PONG and Discord saves the URL. (It refuses to
   save if verification fails — that's the built-in proof it works.)

### The second channel (mirror)
- **Discord webhook**: target channel → *Edit Channel → Integrations →
  Webhooks → New Webhook → Copy URL*.
- **Slack webhook**: <https://api.slack.com/messaging/webhooks> → create an
  Incoming Webhook, copy the URL.
- Paste it in the dashboard under the connected server, pick the matching type,
  and save. (The URL is write-only from the UI.)

---

## Deploy to Vercel (free, no card)

1. Push this repo to GitHub, then *Import Project* in Vercel.
2. Add all env vars from the table above in *Project → Settings → Environment
   Variables*.
3. **Build command** is `npm run build` (runs `prisma generate` + `next build`).
   After the first deploy, run `npx prisma db push` against your production
   `DATABASE_URL` once to create the tables (or add it to the build command).
4. Deploy. Then set the Discord Interactions Endpoint URL to
   `https://<app>.vercel.app/api/interactions` and run `npm run register-commands`.
5. `vercel.json` already schedules the outbox sweep every 5 minutes.

---

## How to test it (for reviewers)

In your test server:
- `/status` → ephemeral-style status reply, logged in the dashboard.
- `/report the database is down` → reply tagged **[URGENT]** (keyword rule),
  `Acknowledge`/`Escalate` buttons, a row in the live log, and a mirror
  notification in the second channel. Click **Escalate** → a second mirror.
- `/report` with no text → a **modal** opens; submit it to file the report.
- Dashboard (`/` → login) → live log, command config editor, server/mirror
  config, and a failures panel with retry.

**Unhappy paths we handle** (see `tests/` and the verification notes in
`AI_NOTES.md`): forged/unsigned/tampered requests → 401; duplicate delivery →
single record; mirror target down → recorded `FAILED`, retryable, swept by
cron; slow AI → deferred + followup within the window.

Login for a throwaway admin and an invite link are provided with the
submission (out of band, not in the repo).

---

## Project layout

```
src/
  app/
    api/interactions/route.ts   # verify -> handle -> respond (+ after() work)
    api/auth/{login,logout}      # session cookie
    api/{config,servers,actions} # dashboard mutations (self-guarded)
    api/cron/sweep               # outbox safety net
    dashboard/                   # live log + config UI (server + client comps)
    login/                       # admin sign-in
  lib/
    discord/verify.ts            # Ed25519 (unit-tested)
    interactions/process.ts      # command/button/modal logic, dedup, defer
    mirror.ts  rules.ts  ai.ts   # second channel / rule engine / Gemini
    actions.ts  retry.ts         # outbox runner + backoff
    auth-session.ts auth-password.ts  # edge-safe JWT vs Node-only scrypt
prisma/schema.prisma
scripts/register-commands.ts  scripts/seed-admin.ts
tests/verify.test.ts  tests/rules.test.ts
```
