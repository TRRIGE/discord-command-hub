import { env } from "@/lib/env";
import { fetchOk, withRetry } from "@/lib/retry";
import { log } from "@/lib/logger";

export interface TriageResult {
  summary: string;
  tags: string[];
}

/**
 * Triage command text with Google Gemini (free tier, no card). Returns a short
 * summary + tags. Kept optional: if GEMINI_API_KEY is unset we return null and
 * the caller falls back to the keyword rule only. Errors are swallowed to null
 * so the AI never breaks the core flow — but the failure is logged.
 */
export async function triageText(text: string): Promise<TriageResult | null> {
  if (!env.aiEnabled || !text.trim()) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

  const prompt = [
    "You triage short user-submitted reports for a support dashboard.",
    "Return ONLY minified JSON: {\"summary\": string (<=140 chars), \"tags\": string[] (1-3 lowercase tags)}.",
    "No prose, no markdown fences.",
    "",
    `Report: """${text.slice(0, 2000)}"""`,
  ].join("\n");

  try {
    const res = await withRetry(
      () =>
        fetchOk(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
          }),
          timeoutMs: 10000,
        }),
      { retries: 2 }
    );

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return parseTriage(raw);
  } catch (err) {
    log.error("ai.triage_failed", { error: String(err).slice(0, 200) });
    return null;
  }
}

function parseTriage(raw: string): TriageResult | null {
  // Strip accidental code fences then grab the first JSON object.
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { summary?: string; tags?: string[] };
    return {
      summary: (obj.summary ?? "").slice(0, 200),
      tags: Array.isArray(obj.tags) ? obj.tags.slice(0, 5).map(String) : [],
    };
  } catch {
    return null;
  }
}
