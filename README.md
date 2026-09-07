# Cribbage

Two-handed cribbage played asynchronously in the browser. Start a game, send
your opponent a link, and take your turns whenever you like — the board waits
for you.

- Full standard rules: six-card deal, the crib, the cut, pegging to 31, and the
  show. His heels and his nob included.
- Every point scored automatically, with a breakdown explaining where it came
  from.
- As many simultaneous games as you have opponents.
- Passwordless sign-in: an emailed link, no password to remember.

---

## Contents

- [How it is put together](#how-it-is-put-together)
- [Project structure](#project-structure)
- [Data model](#data-model)
- [The game engine](#the-game-engine)
- [Getting started](#getting-started)
- [Testing](#testing)
- [API reference](#api-reference)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Design notes](#design-notes)

---

## How it is put together

| Layer      | Choice                                                     |
| ---------- | ---------------------------------------------------------- |
| Framework  | Next.js 16 (App Router), React 19, TypeScript               |
| Database   | Prisma 6 — SQLite locally, Postgres in production           |
| Auth       | Magic links + a stateless, HMAC-signed session cookie       |
| Styling    | One hand-written stylesheet; no UI framework                |
| Tests      | Vitest for the engine, a scripted HTTP smoke test for the app |

The whole thing runs comfortably on a free tier: one Node process, one small
Postgres database, no websockets, no background workers.

---

## Project structure

```
src/
├── lib/
│   ├── cribbage/              # The rules. Pure, dependency-free, fully tested.
│   │   ├── cards.ts           #   Card encoding, deck, seeded shuffle
│   │   ├── scoring.ts         #   The show: fifteens, pairs, runs, flush, nob
│   │   ├── pegging.ts         #   Legal plays and pegging scores
│   │   ├── engine.ts          #   The state machine (applyAction)
│   │   ├── view.ts            #   Per-seat projections; hides secret cards
│   │   ├── types.ts           #   GameState, Action, GameEvent, …
│   │   └── __tests__/         #   69 unit tests
│   ├── api-types.ts           # The browser ⇄ server contract
│   └── server/
│       ├── env.ts             #   Validated configuration
│       ├── db.ts              #   Prisma client singleton
│       ├── auth.ts            #   Magic links, sessions
│       ├── games.ts           #   Persistence and the move pipeline
│       ├── mail.ts            #   Provider-agnostic email
│       ├── notify.ts          #   "It's your turn" hook
│       └── http.ts            #   JSON responses, error mapping, rate limit
├── app/
│   ├── page.tsx               # Landing
│   ├── login/                 # Sign-in
│   ├── auth/callback/         # Magic-link redemption
│   ├── games/                 # Lobby
│   ├── games/[id]/            # The board
│   ├── join/[code]/           # Invite acceptance
│   ├── api/                   # REST endpoints
│   └── globals.css            # The design system
└── components/                # Board, cards, history log, game client
prisma/schema.prisma           # Data model
scripts/
├── smoke.mjs                  # End-to-end test over real HTTP
├── dev-bot.mjs                # A legal (but weak) opponent for solo testing
└── use-database.mjs           # Switch SQLite ⇄ Postgres
```

---

## Data model

Five tables. The full game state lives in one JSON column; the scalar columns
beside it are projections kept in sync on every write, so the lobby can be
listed without deserializing anything.

| Model          | Purpose                                                              |
| -------------- | -------------------------------------------------------------------- |
| `User`         | A player. Identified by email; no password field exists.              |
| `LoginToken`   | A single-use magic link. Only the SHA-256 hash is stored.             |
| `Game`         | One match: both players, the serialized state, and the projections.   |
| `GameEvent`    | Append-only action log — one row per thing that happened.             |
| `Notification` | Records a dispatched turn alert, keyed so it can never fire twice.    |

Two columns on `Game` are worth calling out:

- **`pendingMask`** — a bitmask of seats that may act right now. Discarding is
  simultaneous, so both bits can be set at once; a finished game sets none.
  This is what makes "is it my turn?" a cheap lookup.
- **`version`** — bumped on every applied action. Moves carry the version the
  player was looking at, so a stale tab or a double submit is rejected with a
  409 instead of being applied to a state nobody saw.

---

## The game engine

`src/lib/cribbage` knows nothing about HTTP, React or the database. It exposes
one function:

```ts
applyAction(state, action, { names, rng }) → { state, events }
```

It is pure — the input state is never mutated — which makes it replayable and
exhaustively testable. Randomness is injected, so a game can be seeded and
reproduced exactly.

**Phases.** `awaiting_opponent → discard → pegging → counting → (next deal)`,
ending at `complete` the instant someone reaches 121.

**Rules covered.**

| Area    | Detail                                                                     |
| ------- | -------------------------------------------------------------------------- |
| Deal    | Six each, dealer decided by a cut, deal alternates every hand                |
| Crib    | Two from each player; belongs to the dealer                                 |
| Cut     | Starter turned from the remaining 40; a jack pays the dealer 2 (his heels)   |
| Pegging | Fifteen, thirty-one, pairs/royals, runs in any order, go, last card          |
| Show    | Fifteens, pairs, longest runs with multipliers, flush, his nob               |
| Crib    | Stricter flush rule: five cards or nothing                                  |
| Winning | Exactly 121, detected mid-show; skunk (< 91) and double skunk (< 61) noted   |

**"Go" is automatic.** A player holding no card that fits under 31 has no
decision to make, so the engine declares the go on their behalf and logs it.
That keeps an asynchronous game from stalling for hours on a forced move.

**Hidden information is enforced at the projection layer.** The API never
serializes a raw `GameState`. `playerView(state, seat)` returns only what that
seat is entitled to see — your own hand, the public play, the crib once it is
turned up — and it is unit-tested for leaks. The opponent's discard is likewise
stripped from the action log.

---

## Getting started

Requires Node 20.11 or newer.

```bash
git clone <your-fork> cribbage && cd cribbage
npm install
cp .env.example .env
npm run db:push
npm run dev
```

Open <http://localhost:3000>.

No mail provider is needed locally: `DEV_ECHO_MAGIC_LINK` puts the sign-in link
straight on the page (and the server log), so you can click through in one step.

### Playing on your own

Start a game in the browser, copy the invite code, and give it to the bundled
opponent:

```bash
npm run bot -- ABCD1234
```

It signs in as `bot@example.test`, joins, and plays legally (though not well)
whenever it is its turn. Add `--once` to make a single move.

---

## Testing

```bash
npm test          # 69 unit tests over the rules engine
npm run typecheck # tsc --noEmit
npm run lint      # ESLint, flat config, next/core-web-vitals + next/typescript
npm run smoke     # full game over real HTTP; needs the dev server running
```

The unit tests cover card handling, every scoring rule (including the perfect
29 hand, double runs, and the crib flush exception), turn and legality
enforcement, go/last-card handling, mid-show wins, and hidden-information
redaction. A simulation plays eight seeded games to completion and asserts that
each one terminates with a winner on exactly 121 and never loses a card.

`npm run smoke` goes further: it signs two players in through the real magic-link
flow, opens and accepts an invite, refuses a third party, plays a whole game to
121 through the HTTP API, and asserts at every step that neither player's
response contains the other's hidden cards.

---

## API reference

All endpoints return JSON. Authentication is the session cookie; the seat is
always derived from the session, never from the request body, so a player
cannot move for their opponent.

| Method | Path                    | Purpose                                        |
| ------ | ----------------------- | ---------------------------------------------- |
| `POST` | `/api/auth/request`     | Send a sign-in link. `{ email, next? }`         |
| `GET`  | `/auth/callback`        | Redeem a link and start a session                |
| `POST` | `/api/auth/signout`     | Clear the session                                |
| `GET`  | `/api/me`               | The signed-in player                             |
| `PATCH`| `/api/me`               | Rename. `{ displayName }`                        |
| `GET`  | `/api/games`            | Every game you are in                            |
| `POST` | `/api/games`            | Open a game; returns an invite link              |
| `POST` | `/api/games/join`       | Accept an invite. `{ code }`                     |
| `GET`  | `/api/games/:id`        | The board from your point of view                |
| `POST` | `/api/games/:id/move`   | Apply an action                                  |

Move bodies:

```jsonc
{ "type": "discard", "cards": ["5H", "5S"], "version": 12 }
{ "type": "play",    "card": "TD",          "version": 13 }
{ "type": "count",                          "version": 14 }
```

Status codes: `401` not signed in, `403` not your game, `409` your view was
stale, `422` the rules rejected the move, `429` rate limited.

---

## Configuration

Everything lives in `.env`; see `.env.example` for the annotated list.

| Variable                 | Required | Notes                                             |
| ------------------------ | -------- | ------------------------------------------------- |
| `DATABASE_URL`           | yes      | `file:./dev.db` locally, a Postgres URL in prod    |
| `AUTH_SECRET`            | in prod  | `openssl rand -base64 48`. Rotating it signs everyone out |
| `APP_URL`                | yes      | Public origin; magic and invite links are built from it |
| `MAGIC_LINK_TTL_MINUTES` | no       | Default 15                                        |
| `SESSION_TTL_DAYS`       | no       | Default 30                                        |
| `DEV_ECHO_MAGIC_LINK`    | no       | Dev only; shows the link instead of emailing it   |
| `EMAIL_WEBHOOK_URL`      | no       | Any provider that takes a JSON POST               |
| `EMAIL_WEBHOOK_TOKEN`    | no       | Sent as `Authorization: Bearer …`                 |
| `EMAIL_FROM`             | no       | Sender address                                    |
| `NOTIFY_WEBHOOK_URL`     | no       | Fires once per turn hand-off                      |
| `NOTIFY_WEBHOOK_TOKEN`   | no       | Sent as `Authorization: Bearer …`                 |

With no email or webhook configured, both hooks log instead of sending, so
nothing breaks and you can see exactly what would have gone out.

### Turn notifications

`notify()` in `src/lib/server/notify.ts` fires when a move hands the turn over,
or when a game ends. It posts this to `NOTIFY_WEBHOOK_URL`:

```json
{
  "type": "your_turn",
  "gameId": "…",
  "url": "https://your-app/games/…",
  "summary": "It is your turn against Ada. The score is 64–71.",
  "recipient": { "id": "…", "email": "…", "name": "Grace" },
  "opponent": { "id": "…", "name": "Ada" },
  "scores": [64, 71]
}
```

Point it at a push service, a Discord or Slack webhook, or your own relay. A
`Notification` row keyed on the game version makes it idempotent, so a retried
request never notifies the same turn twice.

---

## Deployment

The app is a single Node process plus a database. Pick whichever host you like.

### 1. Switch to Postgres

SQLite is a local-development convenience — most hosts give you an ephemeral or
read-only filesystem, so production needs a real database.

```bash
npm run db:use postgresql
export DATABASE_URL="postgresql://…"
npx prisma migrate dev --name init   # once, then commit prisma/migrations
```

### 2. Deploy

**Vercel** — import the repository. `vercel.json` sets the build command to run
migrations first. Set `DATABASE_URL`, `AUTH_SECRET` and `APP_URL` in the project
settings.

**Render** — `render.yaml` is a complete blueprint: it provisions a free
Postgres instance, wires `DATABASE_URL` to it, and generates `AUTH_SECRET`. You
only need to set `APP_URL` after the first deploy assigns a hostname.

**Docker** — anywhere that runs a container:

```bash
docker build -t cribbage .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://…" \
  -e AUTH_SECRET="$(openssl rand -base64 48)" \
  -e APP_URL="https://cribbage.example.com" \
  cribbage
```

The image is a multi-stage build on `node:22-alpine` using Next's standalone
output, runs as a non-root user, and applies pending migrations on start.

### Checklist

- [ ] `AUTH_SECRET` is a fresh random value, not the one in `.env.example`
- [ ] `APP_URL` matches the real origin — sign-in links are built from it
- [ ] `DEV_ECHO_MAGIC_LINK` is unset (it is ignored in production regardless)
- [ ] An email provider is configured, or sign-in links go nowhere
- [ ] `prisma migrate deploy` runs as part of the deploy

---

## Design notes

A few decisions worth knowing about if you plan to change things.

**Polling, not websockets.** The board polls every 6 seconds while you wait and
every 20 while it is your move, plus immediately whenever the tab regains
focus. For a game where turns are minutes or hours apart, this costs almost
nothing and keeps the app deployable to any host — no persistent connections,
no sticky sessions. If you want live updates, `GET /api/games/:id` is already
the right shape to back an SSE stream.

**Stateless sessions.** A signed cookie means no session table and no lookup on
every request. The trade is that a single session cannot be revoked early;
rotating `AUTH_SECRET` invalidates all of them at once. For a game this is the
right side of the trade.

**Optimistic concurrency instead of locks.** Every move is applied inside a
transaction guarded by `WHERE version = ?`. Two tabs racing produce one applied
move and one 409, which the client turns into a refresh.

**The rate limiter is per-process.** It lives in memory, which is correct for a
single free-tier instance and wrong the moment you run two. Move it to Redis or
Upstash before scaling out.

**Cards keep their ivory face in both themes.** A playing card is a physical
object, not a UI surface — inverting it in dark mode makes the table harder to
read, not easier.
