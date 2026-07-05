import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import LogoutButton from "./LogoutButton";
import AutoRefresh from "./AutoRefresh";
import RetryButton from "./RetryButton";
import ServerConfigForm, { type ServerView } from "./ServerConfigForm";
import CommandConfigForm, { type CommandConfigView } from "./CommandConfigForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function Dashboard() {
  const session = await getSession();

  const [servers, logs, totalCount, failedActions, actionStats, recentActions] = await Promise.all([
    prisma.server.findMany({
      orderBy: { createdAt: "asc" },
      include: { commandConfigs: { orderBy: { name: "asc" } } },
    }),
    prisma.interactionLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.interactionLog.count(),
    prisma.action.findMany({
      // FAILED, plus PENDING that got stranded (>2 min old) — both need attention.
      where: {
        OR: [
          { status: "FAILED" },
          { status: "PENDING", createdAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.action.groupBy({ by: ["status"], _count: true }),
    // Recent actions (all statuses) so the log shows "every command AND action".
    prisma.action.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { interaction: { select: { commandName: true, userName: true } } },
    }),
  ]);

  const success = actionStats.find((a) => a.status === "SUCCESS")?._count ?? 0;
  const failed = actionStats.find((a) => a.status === "FAILED")?._count ?? 0;

  // Map to view models — CRUCIALLY, never leak the mirror webhook secret.
  const serverViews: (ServerView & { configs: CommandConfigView[] })[] = servers.map((s) => ({
    id: s.id,
    guildId: s.guildId,
    guildName: s.guildName,
    postChannelId: s.postChannelId,
    mirrorType: s.mirrorType,
    hasMirrorWebhook: Boolean(s.mirrorWebhookUrl),
    configs: s.commandConfigs.map((c) => ({
      id: c.id,
      name: c.name,
      enabled: c.enabled,
      mirrorOnRun: c.mirrorOnRun,
      aiEnabled: c.aiEnabled,
      responseTemplate: c.responseTemplate,
      flagKeywords: c.flagKeywords,
      flagTag: c.flagTag,
    })),
  }));

  return (
    <>
      <div className="topbar">
        <div className="brand">🤖 Slash-Command Bot · Dashboard</div>
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <span className="mono" style={{ color: "var(--muted)" }}>{session?.email}</span>
          <LogoutButton />
        </div>
      </div>

      <AutoRefresh seconds={5} />

      <div className="container">
        <div className="stat-row">
          <div className="stat"><div className="n">{totalCount}</div><div className="l">Interactions</div></div>
          <div className="stat"><div className="n">{servers.length}</div><div className="l">Servers</div></div>
          <div className="stat"><div className="n">{success}</div><div className="l">Actions OK</div></div>
          <div className="stat"><div className="n" style={{ color: failed ? "var(--red)" : undefined }}>{failed}</div><div className="l">Actions failed</div></div>
          <div className="stat"><div className="n">{env.aiEnabled ? "on" : "off"}</div><div className="l">AI triage</div></div>
        </div>

        {/* Failed actions — observability: visible history of failures + retry */}
        {failedActions.length > 0 && (
          <div className="panel">
            <h2>Downstream actions needing attention</h2>
            <p className="hint">Failed (auto-retried) or stranded actions. Fix the target, then retry — or wait for the 5-min cron sweep.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Type</th><th>Target</th><th>Attempts</th><th>Error</th><th>When</th><th></th></tr>
                </thead>
                <tbody>
                  {failedActions.map((a) => (
                    <tr key={a.id}>
                      <td>{a.type}</td>
                      <td>{a.target}</td>
                      <td>{a.attempts}</td>
                      <td className="mono" style={{ maxWidth: 320 }}>{a.lastError}</td>
                      <td>{timeAgo(a.updatedAt)}</td>
                      <td className="right"><RetryButton actionId={a.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Command log */}
        <div className="panel">
          <h2>Command log (live)</h2>
          <p className="hint">Most recent 30 interactions. Refreshes every 5s.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th><th>Command</th><th>User</th><th>Text</th>
                  <th>Rule</th><th>AI summary</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No interactions yet — run a slash command in Discord.</td></tr>
                )}
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{timeAgo(l.createdAt)}</td>
                    <td className="mono">/{l.commandName}</td>
                    <td>{l.userName ?? "—"}</td>
                    <td style={{ maxWidth: 240 }}>{l.commandText ?? "—"}</td>
                    <td>{l.appliedTag ? <span className="badge yellow">{l.appliedTag}</span> : "—"}</td>
                    <td style={{ maxWidth: 220 }}>{l.aiSummary ?? "—"}</td>
                    <td><StatusBadge status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions taken — the second half of "every command AND action" */}
        <div className="panel">
          <h2>Actions taken (live)</h2>
          <p className="hint">Every side effect the bot performed: mirror notifications and deferred followups.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>When</th><th>Type</th><th>For command</th><th>Target</th><th>Attempts</th><th>Status</th></tr>
              </thead>
              <tbody>
                {recentActions.length === 0 && (
                  <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No actions yet.</td></tr>
                )}
                {recentActions.map((a) => (
                  <tr key={a.id}>
                    <td>{timeAgo(a.createdAt)}</td>
                    <td className="mono">{a.type}</td>
                    <td>{a.interaction ? `/${a.interaction.commandName}` : "—"}</td>
                    <td>{a.target ?? "—"}</td>
                    <td>{a.attempts}</td>
                    <td><ActionBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Servers + per-command config */}
        {serverViews.length === 0 ? (
          <div className="panel">
            <h2>No servers connected yet</h2>
            <p className="hint">
              Add the bot to a server and run a command — it auto-registers here. Then configure its
              mirror channel and rules below.
            </p>
          </div>
        ) : (
          serverViews.map((s) => (
            <div key={s.id}>
              <ServerConfigForm server={s} />
              <div className="grid">
                {s.configs.length === 0 ? (
                  <div className="panel"><p className="hint">No commands run in this server yet.</p></div>
                ) : (
                  s.configs.map((c) => <CommandConfigForm key={c.id} config={c} />)
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "processed" ? "green" :
    status === "failed" ? "red" :
    status === "escalated" ? "yellow" : "muted";
  return <span className={`badge ${cls}`}>{status}</span>;
}

function ActionBadge({ status }: { status: string }) {
  const cls = status === "SUCCESS" ? "green" : status === "FAILED" ? "red" : "yellow";
  return <span className={`badge ${cls}`}>{status}</span>;
}
