import type { CommandConfig } from "@prisma/client";

export interface RuleOutcome {
  /** Tag applied by the keyword rule, or null if nothing matched. */
  tag: string | null;
  /** Which keyword triggered it (for the log/observability). */
  matchedKeyword: string | null;
}

/**
 * Apply the configurable keyword rule to a piece of command text.
 * If any configured keyword appears (case-insensitive, whole-substring),
 * the interaction is flagged with `flagTag`. This is intentionally simple and
 * fully driven by CommandConfig so behavior is editable from the dashboard,
 * not hard-coded.
 */
export function applyRule(text: string, config: Pick<CommandConfig, "flagKeywords" | "flagTag">): RuleOutcome {
  const haystack = (text ?? "").toLowerCase();
  const keywords = config.flagKeywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  for (const kw of keywords) {
    if (haystack.includes(kw)) {
      return { tag: config.flagTag, matchedKeyword: kw };
    }
  }
  return { tag: null, matchedKeyword: null };
}

/**
 * Interpolate a response template with runtime values. Missing values render
 * as empty strings so a template referencing {summary} is safe when AI is off.
 */
export function renderTemplate(
  template: string,
  vars: { command?: string; text?: string; tag?: string; summary?: string }
): string {
  return template
    .replaceAll("{command}", vars.command ?? "")
    .replaceAll("{text}", vars.text ?? "")
    .replaceAll("{tag}", vars.tag ?? "")
    .replaceAll("{summary}", vars.summary ?? "")
    .trim();
}
