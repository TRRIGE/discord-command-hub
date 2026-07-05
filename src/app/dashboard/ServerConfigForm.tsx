"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ServerView {
  id: string;
  guildId: string;
  guildName: string | null;
  postChannelId: string | null;
  mirrorType: "NONE" | "SLACK" | "DISCORD";
  hasMirrorWebhook: boolean; // never send the secret itself
}

export default function ServerConfigForm({ server }: { server: ServerView }) {
  const router = useRouter();
  const [postChannelId, setPostChannelId] = useState(server.postChannelId ?? "");
  const [mirrorType, setMirrorType] = useState(server.mirrorType);
  const [mirrorWebhookUrl, setMirrorWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: server.id,
          postChannelId,
          mirrorType,
          mirrorWebhookUrl, // blank => keep existing secret
        }),
      });
      setMsg(res.ok ? "Saved." : "Save failed.");
      if (res.ok) {
        setMirrorWebhookUrl("");
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <h2>
        Server <span className="mono">{server.guildName || server.guildId}</span>
      </h2>
      <p className="hint">
        Guild ID <span className="mono">{server.guildId}</span> · Mirror secret is stored
        server-side and never shown here.
      </p>

      <div className="row">
        <div>
          <label>Post channel ID (bot announcements)</label>
          <input
            type="text"
            value={postChannelId}
            onChange={(e) => setPostChannelId(e.target.value)}
            placeholder="e.g. 123456789012345678"
          />
        </div>
        <div>
          <label>Mirror type (second channel)</label>
          <select value={mirrorType} onChange={(e) => setMirrorType(e.target.value as ServerView["mirrorType"])}>
            <option value="NONE">None</option>
            <option value="SLACK">Slack Incoming Webhook</option>
            <option value="DISCORD">Discord channel webhook</option>
          </select>
        </div>
      </div>

      <label>
        Mirror webhook URL{" "}
        {server.hasMirrorWebhook ? (
          <span className="badge green">configured</span>
        ) : (
          <span className="badge muted">not set</span>
        )}
      </label>
      <input
        type="password"
        value={mirrorWebhookUrl}
        onChange={(e) => setMirrorWebhookUrl(e.target.value)}
        placeholder={server.hasMirrorWebhook ? "•••• (leave blank to keep current)" : "Paste webhook URL"}
      />

      <div style={{ marginTop: 14 }}>
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save server settings"}
        </button>
        {msg && <span className="ok" style={{ marginLeft: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}
