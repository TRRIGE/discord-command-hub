import { prisma } from "@/lib/db";
import { runAction } from "@/lib/actions";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Safety-net sweep for the outbox. Re-runs FAILED actions and any PENDING
 * actions that got stranded (e.g. the process died mid-`after()` before the
 * side effect ran). This is what guarantees an interaction's downstream effect
 * is never silently lost.
 *
 * Protected by CRON_SECRET. Vercel Cron sends `Authorization: Bearer <secret>`
 * when CRON_SECRET is set; see vercel.json. Bounded batch to stay fast/cheap.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // PENDING older than 2 minutes counts as "stranded"; FAILED with < 6 attempts
  // is eligible for another automatic try.
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);

  const stranded = await prisma.action.findMany({
    where: {
      OR: [
        { status: "PENDING", createdAt: { lt: twoMinAgo } },
        { status: "FAILED", attempts: { lt: 6 } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 25,
  });

  let ok = 0;
  let failed = 0;
  for (const action of stranded) {
    const before = action.status;
    await runAction(action);
    const after = await prisma.action.findUnique({ where: { id: action.id } });
    if (after?.status === "SUCCESS") ok++;
    else failed++;
    log.info("cron.sweep.item", { actionId: action.id, before, after: after?.status });
  }

  log.info("cron.sweep.done", { scanned: stranded.length, ok, failed });
  return Response.json({ scanned: stranded.length, recovered: ok, stillFailing: failed });
}
