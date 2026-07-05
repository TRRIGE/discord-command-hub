import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Update a connected server: the post channel and the mirror (second channel).
 * The mirror webhook URL is a secret and only ever travels server->DB here; it
 * is never sent back to the browser (see the dashboard query select).
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    id?: string;
    guildId?: string;
    postChannelId?: string;
    mirrorType?: "NONE" | "SLACK" | "DISCORD";
    mirrorWebhookUrl?: string;
  } | null;

  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });

  // Allow connecting a brand-new server by guildId, or editing an existing one.
  const data = {
    postChannelId: emptyToNull(body.postChannelId),
    mirrorType: body.mirrorType ?? "NONE",
    // Only overwrite the webhook when a new value is supplied (keep secret otherwise).
    ...(body.mirrorWebhookUrl && body.mirrorWebhookUrl.trim()
      ? { mirrorWebhookUrl: body.mirrorWebhookUrl.trim() }
      : {}),
    connectedBy: session.email,
  };

  let server;
  if (body.id) {
    server = await prisma.server.update({ where: { id: body.id }, data });
  } else if (body.guildId) {
    server = await prisma.server.upsert({
      where: { guildId: body.guildId.trim() },
      update: data,
      create: { guildId: body.guildId.trim(), ...data },
    });
  } else {
    return Response.json({ error: "Provide id or guildId" }, { status: 400 });
  }

  return Response.json({ ok: true, server: { id: server.id } });
}

function emptyToNull(v?: string): string | null {
  const t = v?.trim();
  return t ? t : null;
}
