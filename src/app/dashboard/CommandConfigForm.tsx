"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CommandConfigView {
  id: string;
  name: string;
  enabled: boolean;
  mirrorOnRun: boolean;
  aiEnabled: boolean;
  responseTemplate: string;
  flagKeywords: string;
  flagTag: string;
}

export default function CommandConfigForm({ config }: { config: CommandConfigView }) {
  const router = useRouter();
  const [state, setState] = useState(config);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  function set<K extends keyof CommandConfigView>(key: K, value: CommandConfigView[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      setMsg(res.ok ? "Saved." : "Save failed.");
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel">
      <h2>
        /{state.name}{" "}
        {state.enabled ? (
          <span className="badge green">enabled</span>
        ) : (
          <span className="badge red">disabled</span>
        )}
      </h2>
      <p className="hint">
        Placeholders in the reply: <span className="mono">{"{command} {text} {tag} {summary}"}</span>
      </p>

      <div className="row">
        <label className="checkbox">
          <input type="checkbox" checked={state.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Enabled
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={state.mirrorOnRun} onChange={(e) => set("mirrorOnRun", e.target.checked)} />
          Mirror on run
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={state.aiEnabled} onChange={(e) => set("aiEnabled", e.target.checked)} />
          AI triage
        </label>
      </div>

      <label>Reply template</label>
      <textarea value={state.responseTemplate} onChange={(e) => set("responseTemplate", e.target.value)} />

      <div className="row">
        <div>
          <label>Flag keywords (comma-separated)</label>
          <input type="text" value={state.flagKeywords} onChange={(e) => set("flagKeywords", e.target.value)} />
        </div>
        <div>
          <label>Flag tag</label>
          <input type="text" value={state.flagTag} onChange={(e) => set("flagTag", e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save command config"}
        </button>
        {msg && <span className="ok" style={{ marginLeft: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}
