import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { applyRule, renderTemplate } from "@/lib/rules";
import { triageText } from "@/lib/ai";
import { runAction } from "@/lib/actions";
import { postToChannel } from "@/lib/discord/rest";
import {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  ComponentType,
  ButtonStyle,
  TextInputStyle,
  type DiscordInteraction,
} from "@/lib/discord/types";
import type { CommandConfig, Server } from "@prisma/client";

export interface HandledInteraction {
  /** JSON body to return to Discord immediately (must be within ~3s). */
  response: unknown;
  /** Optional slow work to run after the response is flushed (via `after()`). */
  background?: () => Promise<void>;
}

/** Entry point: route the interaction by type. Signature is already verified. */
export async function handleInteraction(i: DiscordInteraction): Promise<HandledInteraction> {
  switch (i.type) {
    case InteractionType.PING:
      return { response: { type: InteractionResponseType.PONG } };
    case InteractionType.APPLICATION_COMMAND:
      return handleCommand(i);
    case InteractionType.MESSAGE_COMPONENT:
      return handleComponent(i);
    case InteractionType.MODAL_SUBMIT:
      return handleModal(i);
    default:
      return { response: ephemeral("Unsupported interaction type.") };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ephemeral(content: string) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: MessageFlags.EPHEMERAL },
  };
}

function userOf(i: DiscordInteraction) {
  const u = i.member?.user ?? i.user;
  return {
    id: u?.id ?? "unknown",
    name: u?.global_name ?? u?.username ?? "unknown",
  };
}

function optionText(i: DiscordInteraction): string {
  const opt = i.data?.options?.find((o) => o.name === "text");
  return opt?.value != null ? String(opt.value) : "";
}

/** Auto-connect a server on first sight so commands work; dashboard configures it. */
async function ensureServer(guildId: string | undefined): Promise<Server | null> {
  if (!guildId) return null;
  return prisma.server.upsert({
    where: { guildId },
    update: {},
    create: { guildId },
  });
}

async function ensureCommandConfig(serverId: string, name: string): Promise<CommandConfig> {
  const existing = await prisma.commandConfig.findUnique({
    where: { serverId_name: { serverId, name } },
  });
  if (existing) return existing;
  return prisma.commandConfig.create({
    data: {
      serverId,
      name,
      responseTemplate:
        name === "report"
          ? "✅ Report recorded{tag}. {summary}"
          : "✅ Status: all systems operational.",
      aiEnabled: name === "report",
    },
  });
}

/**
 * Dedup: returns the existing log if this interaction id was already handled.
 * On redelivery we replay the stored response WITHOUT re-running side effects.
 */
async function findExisting(interactionId: string) {
  return prisma.interactionLog.findUnique({ where: { interactionId } });
}

function actionRow(logId: string) {
  return {
    type: ComponentType.ACTION_ROW,
    components: [
      {
        type: ComponentType.BUTTON,
        style: ButtonStyle.SUCCESS,
        label: "Acknowledge",
        custom_id: `ack:${logId}`,
      },
      {
        type: ComponentType.BUTTON,
        style: ButtonStyle.DANGER,
        label: "Escalate",
        custom_id: `esc:${logId}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

async function handleCommand(i: DiscordInteraction): Promise<HandledInteraction> {
  const name = i.data?.name ?? "unknown";
  const user = userOf(i);

  // Dedup
  const existing = await findExisting(i.id);
  if (existing) {
    log.info("interaction.duplicate", { interactionId: i.id, command: name });
    return {
      response: ephemeral(existing.responseText ?? "Already recorded."),
    };
  }

  const server = await ensureServer(i.guild_id);

  // /report with no text -> open a modal to collect it (stretch: modal form)
  if (name === "report" && !optionText(i)) {
    return { response: reportModalResponse() };
  }

  const config = server ? await ensureCommandConfig(server.id, name) : null;
  if (config && !config.enabled) {
    return { response: ephemeral(`The \`/${name}\` command is currently disabled.`) };
  }

  const text = optionText(i);
  const useAi = Boolean(config?.aiEnabled && env.aiEnabled && text);

  // Persist the log row now (this also claims the dedup key).
  const logRow = await prisma.interactionLog.create({
    data: {
      interactionId: i.id,
      serverId: server?.id,
      guildId: i.guild_id,
      channelId: i.channel_id,
      userId: user.id,
      userName: user.name,
      commandName: name,
      interactionType: i.type,
      commandText: text || null,
      status: "received",
    },
  });

  if (useAi) {
    // Slow path: acknowledge now, follow up after AI within 15-min window.
    return {
      response: { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE },
      background: () => finishReport({ i, server, config: config!, logRow: logRow.id, text, deferred: true }),
    };
  }

  // Fast path: compute the reply now.
  const outcome = config
    ? applyRule(text, config)
    : { tag: null, matchedKeyword: null };
  const responseText = buildReplyText(name, config, text, outcome.tag, null);

  await prisma.interactionLog.update({
    where: { id: logRow.id },
    data: { appliedTag: outcome.tag, responseText, status: "processed" },
  });

  return {
    response: {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: responseText,
        components: name === "report" ? [actionRow(logRow.id)] : [],
      },
    },
    background: () =>
      afterCommand({ server, config, logRow: logRow.id, name, text, tag: outcome.tag, user }),
  };
}

function buildReplyText(
  name: string,
  config: CommandConfig | null,
  text: string,
  tag: string | null,
  summary: string | null
): string {
  const template = config?.responseTemplate ?? "Recorded your {command}.";
  const rendered = renderTemplate(template, {
    command: name,
    text,
    tag: tag ? ` [${tag}]` : "",
    summary: summary ?? "",
  });
  return rendered || `Recorded your /${name}.`;
}

/** Fast-path side effects: mirror + optional channel post. */
async function afterCommand(args: {
  server: Server | null;
  config: CommandConfig | null;
  logRow: string;
  name: string;
  text: string;
  tag: string | null;
  user: { id: string; name: string };
}) {
  const { server, config, logRow, name, text, tag, user } = args;
  await maybeMirror({ server, config, logRow, name, text, tag, userName: user.name, summary: null });
  await maybePostToChannel({ server, name, text, tag, userName: user.name });
}

/** Slow path for /report: run AI, edit the deferred message, then mirror. */
async function finishReport(args: {
  i: DiscordInteraction;
  server: Server | null;
  config: CommandConfig;
  logRow: string;
  text: string;
  deferred: boolean;
}) {
  const { i, server, config, logRow, text } = args;
  const user = userOf(i);

  const outcome = applyRule(text, config);
  const triage = await triageText(text);
  const summary = triage?.summary ?? null;
  const responseText = buildReplyText("report", config, text, outcome.tag, summary);

  await prisma.interactionLog.update({
    where: { id: logRow },
    data: {
      appliedTag: outcome.tag,
      aiSummary: summary,
      aiTags: triage?.tags?.join(",") ?? null,
      responseText,
      status: "processed",
    },
  });

  // Edit the deferred "thinking…" message via the outbox (retried, recorded).
  const followup = await prisma.action.create({
    data: {
      interactionLogId: logRow,
      type: "DISCORD_FOLLOWUP",
      target: "discord:@original",
      payloadJson: {
        token: i.token,
        content: responseText,
        components: [actionRow(logRow)],
      },
    },
  });
  await runAction(followup);

  await maybeMirror({
    server,
    config,
    logRow,
    name: "report",
    text,
    tag: outcome.tag,
    userName: user.name,
    summary,
  });
  await maybePostToChannel({ server, name: "report", text, tag: outcome.tag, userName: user.name });
}

async function maybeMirror(args: {
  server: Server | null;
  config: CommandConfig | null;
  logRow: string;
  name: string;
  text: string;
  tag: string | null;
  userName: string;
  summary: string | null;
}) {
  const { server, config, logRow, name, text, tag, userName, summary } = args;
  if (!server || server.mirrorType === "NONE" || !server.mirrorWebhookUrl) return;
  if (config && !config.mirrorOnRun) return;

  const action = await prisma.action.create({
    data: {
      interactionLogId: logRow,
      type: "MIRROR",
      target: server.mirrorType.toLowerCase(),
      // Store only serverId + message. The secret webhook URL is resolved from
      // the Server row at run time (see runAction) — never snapshotted here.
      payloadJson: {
        serverId: server.id,
        message: {
          title: `New /${name}${tag ? ` [${tag}]` : ""}`,
          lines: [
            `From: ${userName}`,
            text ? `Text: ${text}` : "",
            summary ? `AI: ${summary}` : "",
            `Guild: ${server.guildId}`,
          ].filter(Boolean),
        },
      },
    },
  });
  await runAction(action);
}

async function maybePostToChannel(args: {
  server: Server | null;
  name: string;
  text: string;
  tag: string | null;
  userName: string;
}) {
  const { server, name, text, tag, userName } = args;
  // Only post announcements for flagged reports, to the admin-chosen channel.
  if (!server?.postChannelId || !tag) return;
  try {
    await postToChannel(server.postChannelId, {
      content: `🚨 **${tag}** report from ${userName}: ${text}`,
    });
  } catch (err) {
    log.error("channel_post.failed", { error: String(err).slice(0, 200) });
  }
}

// ---------------------------------------------------------------------------
// Buttons (MESSAGE_COMPONENT)
// ---------------------------------------------------------------------------

async function handleComponent(i: DiscordInteraction): Promise<HandledInteraction> {
  const customId = i.data?.custom_id ?? "";
  const [action, logId] = customId.split(":");
  const user = userOf(i);

  // Dedup the component interaction itself.
  const existing = await findExisting(i.id);
  if (existing) {
    return { response: { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE } };
  }
  await prisma.interactionLog.create({
    data: {
      interactionId: i.id,
      guildId: i.guild_id,
      channelId: i.channel_id,
      userId: user.id,
      userName: user.name,
      commandName: `button:${action}`,
      interactionType: i.type,
      status: "processed",
    },
  });

  const verb = action === "ack" ? "Acknowledged" : action === "esc" ? "Escalated" : "Updated";

  // Record the state change on the original report log.
  if (logId) {
    await prisma.interactionLog
      .update({
        where: { id: logId },
        data: { status: action === "esc" ? "escalated" : "acknowledged" },
      })
      .catch(() => undefined);
  }

  return {
    response: {
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: {
        content: `${verb} by ${user.name}.`,
        components: [], // remove buttons after action
      },
    },
    background:
      action === "esc" && logId
        ? () => escalateMirror(logId, user.name)
        : undefined,
  };
}

async function escalateMirror(logId: string, actor: string) {
  const logRow = await prisma.interactionLog.findUnique({
    where: { id: logId },
    include: { server: true },
  });
  if (!logRow?.server || logRow.server.mirrorType === "NONE" || !logRow.server.mirrorWebhookUrl) return;

  const action = await prisma.action.create({
    data: {
      interactionLogId: logId,
      type: "MIRROR",
      target: logRow.server.mirrorType.toLowerCase(),
      payloadJson: {
        serverId: logRow.server.id,
        message: {
          title: "⚠️ Report escalated",
          lines: [
            `Escalated by: ${actor}`,
            logRow.commandText ? `Text: ${logRow.commandText}` : "",
            `Original by: ${logRow.userName}`,
          ].filter(Boolean),
        },
      },
    },
  });
  await runAction(action);
}

// ---------------------------------------------------------------------------
// Modal (MODAL_SUBMIT)
// ---------------------------------------------------------------------------

function reportModalResponse() {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: "report_modal",
      title: "File a report",
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: "report_text",
              label: "What happened?",
              style: TextInputStyle.PARAGRAPH,
              min_length: 1,
              max_length: 1000,
              required: true,
              placeholder: "Describe the issue…",
            },
          ],
        },
      ],
    },
  };
}

async function handleModal(i: DiscordInteraction): Promise<HandledInteraction> {
  if (i.data?.custom_id !== "report_modal") {
    return { response: ephemeral("Unknown form.") };
  }

  const existing = await findExisting(i.id);
  if (existing) {
    return { response: ephemeral(existing.responseText ?? "Already recorded.") };
  }

  const user = userOf(i);
  const text =
    i.data?.components?.[0]?.components?.find((c) => c.custom_id === "report_text")?.value ?? "";

  const server = await ensureServer(i.guild_id);
  const config = server ? await ensureCommandConfig(server.id, "report") : null;

  const logRow = await prisma.interactionLog.create({
    data: {
      interactionId: i.id,
      serverId: server?.id,
      guildId: i.guild_id,
      channelId: i.channel_id,
      userId: user.id,
      userName: user.name,
      commandName: "report",
      interactionType: i.type,
      commandText: text || null,
      status: "received",
    },
  });

  const useAi = Boolean(config?.aiEnabled && env.aiEnabled && text);
  if (useAi) {
    return {
      response: { type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE },
      background: () => finishReport({ i, server, config: config!, logRow: logRow.id, text, deferred: true }),
    };
  }

  const outcome = config ? applyRule(text, config) : { tag: null, matchedKeyword: null };
  const responseText = buildReplyText("report", config, text, outcome.tag, null);
  await prisma.interactionLog.update({
    where: { id: logRow.id },
    data: { appliedTag: outcome.tag, responseText, status: "processed" },
  });

  return {
    response: {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: responseText, components: [actionRow(logRow.id)] },
    },
    background: () =>
      afterCommand({ server, config, logRow: logRow.id, name: "report", text, tag: outcome.tag, user }),
  };
}
