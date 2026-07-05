import { fetchOk, withRetry } from "@/lib/retry";
import { log } from "@/lib/logger";

export type MirrorType = "SLACK" | "DISCORD" | "NONE";

export interface MirrorMessage {
  title: string;
  lines: string[]; // key: value style lines
}

/**
 * Send a notification to the "second channel". Supports a Slack Incoming
 * Webhook and a Discord channel webhook — both are paste-a-URL, no card.
 * Retries with backoff; throws if it ultimately fails so the caller can mark
 * the outbox Action FAILED (surfaced in the dashboard for manual retry).
 */
export async function sendMirror(
  type: MirrorType,
  webhookUrl: string | null,
  msg: MirrorMessage
): Promise<void> {
  if (type === "NONE" || !webhookUrl) {
    throw new Error("Mirror not configured");
  }

  const body = type === "SLACK" ? buildSlackBody(msg) : buildDiscordBody(msg);

  await withRetry(
    () =>
      fetchOk(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    {
      retries: 3,
      onAttemptError: (err, attempt) =>
        log.warn("mirror.attempt_failed", {
          type,
          attempt,
          error: String(err).slice(0, 200),
        }),
    }
  );
}

function buildSlackBody(msg: MirrorMessage) {
  const text = [`*${msg.title}*`, ...msg.lines].join("\n");
  return { text };
}

function buildDiscordBody(msg: MirrorMessage) {
  // Discord webhooks accept an embed for nicer formatting.
  return {
    embeds: [
      {
        title: msg.title,
        description: msg.lines.join("\n"),
        color: 0x5865f2,
      },
    ],
  };
}
