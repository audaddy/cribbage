import Link from "next/link";
import { redirect } from "next/navigation";
import { createGuestUser, currentUser, suggestGuestName } from "@/lib/server/auth";
import {
  GameAccessError,
  GameConflictError,
  acceptInvite,
  getInviteSummary,
} from "@/lib/server/games";

export const metadata = { title: "Join a game — Cribbage" };
export const dynamic = "force-dynamic";

/**
 * Where a texted invite lands.
 *
 * No account is required: tapping "Join the game" creates a guest on the spot
 * and seats them. The single tap is deliberate — it tells the invitee who
 * invited them, lets them pick a name, and stops a host from accidentally
 * taking the second seat in their own game by opening their own link on
 * another device.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { code } = await params;
  const { error } = await searchParams;
  const viewer = await currentUser();
  const invite = await getInviteSummary(code, viewer?.id);

  // Already at this table? Go straight to the board.
  if (invite && invite.yourSeat !== null) {
    redirect(`/games/${invite.gameId}`);
  }

  async function join(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "");
    let user = await currentUser();
    if (!user) user = await createGuestUser(name);

    let gameId: string;
    try {
      gameId = (await acceptInvite(code, user)).id;
    } catch (cause) {
      // Someone took the seat between the page loading and this submit.
      if (cause instanceof GameAccessError || cause instanceof GameConflictError) {
        redirect(`/join/${encodeURIComponent(code)}?error=taken`);
      }
      throw cause;
    }
    redirect(`/games/${gameId}`);
  }

  if (!invite) {
    return (
      <Problem title="That link is not valid">
        The invite code does not match a game. Ask for a fresh link.
      </Problem>
    );
  }

  if (invite.isFull) {
    return (
      <Problem title="This game is full">
        Every seat at {invite.hostName}&rsquo;s table is taken. Ask them to
        start a new game if you want a table of your own.
      </Problem>
    );
  }

  // What sort of table the visitor is being asked to sit at.
  const blurb =
    invite.variant === "two"
      ? "Two-handed cribbage, one move at a time. Take a turn, close the tab, come back whenever — the board waits for you."
      : invite.variant === "three"
        ? `Three-handed cribbage, everyone for themselves. ${
            invite.seatsOpen > 1
              ? `${invite.seatsOpen} seats still open — the cards are dealt once the table fills.`
              : "You are the last seat — the cards are dealt as soon as you sit down."
          }`
        : `Cribbage in partnerships, four at the table. ${
            invite.seatsOpen > 1
              ? `${invite.seatsOpen} seats still open — the cards are dealt once the table fills.`
              : "You are the last seat — the cards are dealt as soon as you sit down."
          }`;

  return (
    <main className="shell shell--narrow stack">
      <section className="invite-hero stack-sm">
        <span className="table-label">You have been invited</span>
        <h1>{invite.hostName} wants to play cribbage.</h1>
        <p className="small" style={{ opacity: 0.84 }}>
          {blurb}
        </p>
      </section>

      {error === "taken" && (
        <p className="notice notice-error" role="alert">
          Someone else took that seat first. Ask {invite.hostName} for a new
          invite.
        </p>
      )}

      <form className="panel panel-pad stack" action={join}>
        {viewer ? (
          <p className="small muted">
            You are signed in as <strong>{viewer.displayName}</strong>.
          </p>
        ) : (
          <div className="field">
            <label className="label" htmlFor="name">
              What should we call you?
            </label>
            <input
              id="name"
              name="name"
              className="input"
              maxLength={40}
              defaultValue={suggestGuestName()}
              autoComplete="nickname"
            />
            <p className="tiny muted">
              No email, no password. You can change this later.
            </p>
          </div>
        )}

        <button className="btn btn-primary btn-block" type="submit">
          Join the game
        </button>
      </form>

      {!viewer && (
        <p className="tiny muted" style={{ textAlign: "center" }}>
          Already have an account?{" "}
          <Link href={`/login?next=/join/${encodeURIComponent(code)}`}>
            Sign in instead
          </Link>
          .
        </p>
      )}
    </main>
  );
}

function Problem({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="shell shell--narrow stack">
      <div className="panel empty stack-sm">
        <h1>{title}</h1>
        <p className="small">{children}</p>
        <Link className="btn" href="/games">
          Go to your games
        </Link>
      </div>
    </main>
  );
}
