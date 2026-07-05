import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

/** Update a command config (rules, template, toggles) from the dashboard. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    id?: string;
    enabled?: boolean;
    mirrorOnRun?: boolean;
    aiEnabled?: boolean;
    responseTemplate?: string;
    flagKeywords?: string;
    flagTag?: string;
  } | null;

  if (!body?.id) return Response.json({ error: "Missing config id" }, { status: 400 });

  const updated = await prisma.commandConfig.update({
    where: { id: body.id },
    data: {
      enabled: body.enabled,
      mirrorOnRun: body.mirrorOnRun,
      aiEnabled: body.aiEnabled,
      responseTemplate: body.responseTemplate?.slice(0, 500),
      flagKeywords: body.flagKeywords?.slice(0, 500),
      flagTag: body.flagTag?.slice(0, 50),
    },
  });

  return Response.json({ ok: true, config: { id: updated.id } });
}
