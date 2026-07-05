import { env } from "@/lib/env";
import { fetchOk, withRetry } from "@/lib/retry";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Edit the original (deferred) interaction response. After answering with
 * DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, we do slow work then PATCH the message
 * here. Uses the interaction token — no bot token needed, valid for 15 min.
 */
export async function editOriginalInteractionResponse(
  interactionToken: string,
  body: { content?: string; components?: unknown[]; embeds?: unknown[] }
): Promise<void> {
  const url = `${DISCORD_API}/webhooks/${env.discordApplicationId}/${interactionToken}/messages/@original`;
  await withRetry(() =>
    fetchOk(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

/**
 * Post a standalone message to a channel using the bot token. Used to post
 * announcements to the admin-chosen channel (a "write back" beyond the reply).
 */
export async function postToChannel(
  channelId: string,
  body: { content?: string; embeds?: unknown[]; components?: unknown[] }
): Promise<void> {
  const url = `${DISCORD_API}/channels/${channelId}/messages`;
  await withRetry(() =>
    fetchOk(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${env.discordBotToken}`,
      },
      body: JSON.stringify(body),
    })
  );
}
