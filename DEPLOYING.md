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

### Commit with an email GitHub knows about

Vercel will not build a commit whose author it cannot trace to a Git account.
A push from an address that is not on your GitHub account produces a deployment
stuck at status `BLOCKED` with `buildSkipped: true` — no build logs, no error
in the dashboard's usual place, just a deploy that never starts:

```
The deployment was blocked because Vercel couldn't find a Git account
for the commit author.
```

Check the author before you wonder about the build queue:

```bash
git log -1 --format='%ae'
```

If it is not an address on your GitHub account, either add it there (Settings →
Emails) or set the right one for this repository:

```bash
git config user.email you@example.com
```

## 4. Email (optional, but it is what makes async play work)

Without a mail provider the app still works — invite links seat a guest with no
address at all — but sign-in links go to the server log instead of an inbox, and
nobody gets told it is their turn. Resend's free tier sends 3,000 messages a
month and takes about ten minutes.

The quickest route is Vercel's own marketplace: on the project, open
**Integrations → Browse Marketplace → Resend** and install it. Vercel creates
the Resend account, injects `RESEND_API_KEY` into the project, and this app
reads that variable directly — there is nothing to copy and nothing else to
set. Skip to step 2 to decide who you can write to, then redeploy.

To wire it up by hand instead:

1. Sign up at <https://resend.com> and create an API key (**API Keys → Create**).
   Copy it once; Resend will not show it again.

2. Decide who you can send to. This is the part that catches people out:

   - **No domain of your own.** Use the shared sender
     `Cribbage <onboarding@resend.dev>`. Resend will only deliver it to the
     address that owns the account — your own. That is enough for your sign-in
     links and your turn notifications; anyone you invite plays as a guest from
     the invite link and needs no email.
   - **A domain you control.** Add it under **Domains**, publish the DNS records
     Resend gives you, and then any address at that domain can write to anyone.
     This is what you need before a second player can sign in by email.

3. Add three variables to the Vercel project (**Settings → Environment
   Variables**), each for Production — unnecessary if you installed the
   marketplace integration above:

   | Name                  | Value                                  |
   | --------------------- | -------------------------------------- |
   | `EMAIL_WEBHOOK_URL`   | `https://api.resend.com/emails`        |
   | `EMAIL_WEBHOOK_TOKEN` | the API key, starting `re_`            |
   | `EMAIL_FROM`          | `Cribbage <onboarding@resend.dev>`     |

   Mark the key **Sensitive** so it cannot be read back out.

4. Redeploy, then prove it end to end: open `/login` on the live site, ask for a
   sign-in link, and check your inbox.

   To test the credentials before deploying, put the same three values in
   `.env.local` and run:

   ```bash
   npm run mail:test -- you@example.com
   ```

   That prints the provider's own answer, which is the useful one — a refused
   sender or a sandbox restriction says so in the response body.

## 5. Play

1. Open your site and press **Start playing without an account**. You are in
   immediately, with a name you can change from the lobby.

   Signing in by email works too, but with no mail provider configured the
   link is written to the server log rather than sent — find it under
   **Deployments → Logs** in Vercel, or set up email (below). Signing in by
   email later attaches that address to the account you already have, so your
   games come with you.
2. Press **New game** and copy the invite link.
3. Text it to whoever you want to play.

They tap the link, type a name, and they are in. No account, no email, no app.

---

## Turn notifications

These are on already, over web push, and need no account anywhere: the signing
keys are generated with `npx web-push generate-vapid-keys` and set as
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Without them push
is simply off and every other delivery path still works.

Each player taps **Notify me when it's my turn** in the lobby once. Push
reaches guests, which email cannot — a subscription belongs to a browser, and
so does a guest account.

**On iPhone, notifications only work for a site added to the Home Screen.**
That is Apple's restriction, not the app's; the lobby says so when it detects
an iPhone that has not installed the site. Android and desktop just work.

SMS was considered and rejected: sending app-generated texts to US numbers
requires A2P 10DLC brand and campaign registration with the carriers, which is
days of paperwork and a monthly fee to tell two people it is their turn.

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
