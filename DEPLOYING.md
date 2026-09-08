# Putting this online

The goal: a public URL you can text to someone, where tapping the link drops
them straight into a game.

Roughly fifteen minutes. You will need a GitHub account (you have one), a
Vercel account, and a Neon account — both free, both sign in with GitHub.

---

## 1. Push the code to GitHub

```bash
gh repo create cribbage --private --source=. --push
```

Use `--public` instead if you would rather it be open. Nothing secret is
committed — `.env` is ignored, and `.env.example` holds only placeholders.

## 2. Create the database

1. Go to <https://neon.tech> and sign in with GitHub.
2. Create a project. Any region near you is fine.
3. Open **Connect** and copy the connection string twice — once with
   connection pooling on, once with it off. You need both:

   ```
   pooled  postgresql://…@ep-something-pooler.region.aws.neon.tech/neondb?sslmode=require
   direct  postgresql://…@ep-something.region.aws.neon.tech/neondb?sslmode=require
   ```

   The app uses the pooled one: Vercel runs your code as serverless functions
   that open many short-lived connections, and a direct connection runs out of
   them. Migrations use the direct one, because they take advisory locks and
   run DDL in transactions and neither survives a transaction-mode pooler.

## 3. Deploy to Vercel

1. Go to <https://vercel.com/new> and import the repository.
2. Vercel detects Next.js on its own — leave the build settings alone.
   `vercel.json` already tells it to run migrations before building.
3. Add these environment variables before the first deploy:

   | Name           | Value                                              |
   | -------------- | -------------------------------------------------- |
   | `DATABASE_URL` | the **pooled** Neon string (hostname has `-pooler`) |
   | `DIRECT_URL`   | the **direct** Neon string (no `-pooler`)           |
   | `AUTH_SECRET`  | run `openssl rand -base64 48` and paste the result  |

   Both must be set **before** the first deploy: the build runs
   `prisma migrate deploy`, which needs a reachable database.

   You do not need to set `APP_URL`. Vercel exposes the project's stable
   production domain as `VERCEL_PROJECT_PRODUCTION_URL`, and invite links fall
   back to it. Set `APP_URL` only when you put a custom domain in front.

4. Deploy. Vercel assigns a URL like `https://cribbage-xyz.vercel.app`.

## 4. Play

1. Open your site and sign in with your email. No mail provider is configured
   yet, so the sign-in link is written to the server log rather than sent —
   find it under **Deployments → Logs** in Vercel, or set up email (below).
2. Press **New game** and copy the invite link.
3. Text it to whoever you want to play.

They tap the link, type a name, and they are in. No account, no email, no app.

---

## Optional: email

Only needed for signing back in on a new device, and for turn notifications.
Guests never need it.

1. Sign up at <https://resend.com> and create an API key.
2. Add to Vercel:

   ```
   EMAIL_WEBHOOK_URL   https://api.resend.com/emails
   EMAIL_WEBHOOK_TOKEN re_your_key_here
   EMAIL_FROM          Cribbage <onboarding@resend.dev>
   ```

`onboarding@resend.dev` works without a verified domain, which is enough for a
couple of players. To email anyone else, verify a domain in Resend first.

Once email is on, "it's your turn" notifications start working too — the hook
is already written and deduplicated so it never fires twice for the same turn.

---

## A note on guest accounts

Someone who joins by invite link has no password and no email. Their session
cookie *is* their account, for 30 days.

- Clearing site data or switching phones loses access to their games.
- The app warns them before signing out.
- Rotating `AUTH_SECRET` signs out everyone, guests included.

That is the deliberate trade for a link a friend can tap once and be playing.
If you would rather guests could recover their account, the schema already
allows attaching an email to a guest later — `User.email` is nullable and
`User.isGuest` tracks the state.

---

## Costs

Free, at two players. Neon's free tier and Vercel's hobby tier both cover this
comfortably. The app makes no background requests: it polls only while a board
is open, and stops entirely once a game is finished.

Vercel's hobby tier is for non-commercial use, which this is.
