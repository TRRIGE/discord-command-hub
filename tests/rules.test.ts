import { describe, it, expect } from "vitest";
import { applyRule, renderTemplate } from "@/lib/rules";

const config = { flagKeywords: "urgent,broken,down,outage", flagTag: "URGENT" };

describe("applyRule", () => {
  it("flags when a keyword is present (case-insensitive)", () => {
    expect(applyRule("The server is DOWN", config)).toEqual({ tag: "URGENT", matchedKeyword: "down" });
  });

  it("does not flag benign text", () => {
    expect(applyRule("just a friendly note", config)).toEqual({ tag: null, matchedKeyword: null });
  });

  it("handles empty text safely", () => {
    expect(applyRule("", config).tag).toBeNull();
  });

  it("respects custom keywords/tag", () => {
    const custom = { flagKeywords: "vip", flagTag: "PRIORITY" };
    expect(applyRule("a VIP customer", custom)).toEqual({ tag: "PRIORITY", matchedKeyword: "vip" });
  });
});

describe("renderTemplate", () => {
  it("interpolates known placeholders", () => {
    expect(renderTemplate("Recorded {command}{tag}. {summary}", { command: "report", tag: " [URGENT]", summary: "db down" }))
      .toBe("Recorded report [URGENT]. db down");
  });

  it("renders missing vars as empty", () => {
    expect(renderTemplate("Hi {summary}", {})).toBe("Hi");
  });
});
