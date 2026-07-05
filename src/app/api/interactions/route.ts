import { after } from "next/server";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { verifyDiscordSignature } from "@/lib/discord/verify";
import { handleInteraction } from "@/lib/interactions/process";
import type { DiscordInteraction } from "@/lib/discord/types";

// Must run on Node (crypto/Prisma), not the edge. Never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");

  // Read the RAW body exactly as sent — required for signature verification.
  const rawBody = await req.text();

  // 1) Verify Ed25519 signature on EVERY request. Reject forged/unsigned junk.
  const valid = verifyDiscordSignature({
    rawBody,
    signature,
    timestamp,
    publicKey: env.discordPublicKey,
  });
  if (!valid) {
    log.warn("interaction.invalid_signature", { hasSig: Boolean(signature) });
    return new Response("invalid request signature", { status: 401 });
  }

  // 2) Replay hardening (defense-in-depth). A captured, validly-signed request
  // has a valid signature forever, so also reject stale timestamps. The real
  // guarantee against reprocessing is the interaction-id dedup downstream; this
  // just rejects obviously-replayed junk fast. 5-min window tolerates clock skew.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) {
    log.warn("interaction.stale_timestamp", { timestamp });
    return new Response("stale request timestamp", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  try {
    const handled = await handleInteraction(interaction);

    // Run slow/side-effect work AFTER the response is flushed, so we stay well
    // within Discord's ~3s window. On Vercel this is backed by waitUntil.
    if (handled.background) {
      after(async () => {
        try {
          await handled.background!();
        } catch (err) {
          log.error("interaction.background_failed", {
            interactionId: interaction.id,
            error: String(err).slice(0, 300),
          });
        }
      });
    }

    return Response.json(handled.response);
  } catch (err) {
    log.error("interaction.handler_failed", {
      interactionId: interaction.id,
      type: interaction.type,
      error: String(err).slice(0, 300),
    });
    // Return a 200 with an ephemeral error so Discord doesn't show "app didn't
    // respond"; the failure is logged and (for side effects) recorded in the DB.
    return Response.json({
      type: 4,
      data: { content: "Something went wrong handling that. It has been logged.", flags: 64 },
    });
  }
}

// A GET is handy for a quick liveness check in the browser.
export async function GET() {
  return Response.json({ ok: true, service: "discord-interactions" });
}
