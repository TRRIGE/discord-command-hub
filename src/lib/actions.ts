import { prisma } from "@/lib/db";
import { sendMirror, type MirrorMessage } from "@/lib/mirror";
import { editOriginalInteractionResponse } from "@/lib/discord/rest";
import { log } from "@/lib/logger";
import type { Action } from "@prisma/client";

/**
 * Run a single outbox Action, updating its status/attempts/lastError. Never
 * throws — the outcome is persisted so failures are visible and retryable from
 * the dashboard rather than silently lost.
 */
export async function runAction(action: Action): Promise<void> {
  await prisma.action.update({
    where: { id: action.id },
    data: { attempts: { increment: 1 } },
  });

  try {
    const payload = (action.payloadJson ?? {}) as Record<string, unknown>;

    if (action.type === "MIRROR") {
      // Re-resolve the server's CURRENT mirror config at run time. The secret
      // webhook URL lives only on the Server row (never snapshotted into the
      // outbox), so fixing it in the dashboard and hitting "retry" just works.
      const server = await prisma.server.findUnique({
        where: { id: payload.serverId as string },
      });
      if (!server) throw new Error("Server no longer exists");
      await sendMirror(server.mirrorType, server.mirrorWebhookUrl, payload.message as MirrorMessage);
    } else if (action.type === "DISCORD_FOLLOWUP") {
      await editOriginalInteractionResponse(payload.token as string, {
        content: payload.content as string,
        components: (payload.components as unknown[]) ?? undefined,
      });
    }

    await prisma.action.update({
      where: { id: action.id },
      data: { status: "SUCCESS", lastError: null },
    });
    log.info("action.success", { actionId: action.id, type: action.type });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.action.update({
      where: { id: action.id },
      data: { status: "FAILED", lastError: message.slice(0, 500) },
    });
    log.error("action.failed", { actionId: action.id, type: action.type, error: message.slice(0, 200) });
  }
}

/** Re-run a FAILED action by id (used by the dashboard "retry" button). */
export async function retryAction(actionId: string): Promise<void> {
  const action = await prisma.action.findUnique({ where: { id: actionId } });
  if (!action) throw new Error("Action not found");
  await prisma.action.update({ where: { id: actionId }, data: { status: "PENDING" } });
  await runAction({ ...action, status: "PENDING" });
}
