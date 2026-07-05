import { getSession } from "@/lib/session";
import { retryAction } from "@/lib/actions";

export const runtime = "nodejs";

/** Manually retry a FAILED outbox action from the dashboard. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return Response.json({ error: "Missing action id" }, { status: 400 });

  try {
    await retryAction(body.id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
