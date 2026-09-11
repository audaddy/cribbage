import { notFound } from "next/navigation";
import { TableDisplay } from "@/components/TableDisplay";
import { getTableView } from "@/lib/server/table";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return { title: `Room ${code.toUpperCase()} — Cribbage` };
}

/**
 * The board on a television.
 *
 * Open this on the TV itself, or mirror a laptop to it — there is no app and
 * no pairing, only a page. It shows what everyone at a real table can see and
 * nothing else; hands stay on the phones.
 */
export default async function TvPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const table = await getTableView(code, { heartbeat: false });
  if (!table) notFound();

  return (
    <main className="tv-shell">
      <TableDisplay initial={table} />
    </main>
  );
}
