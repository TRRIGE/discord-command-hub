import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { verifyDiscordSignature } from "@/lib/discord/verify";

function toHex(u: Uint8Array): string {
  return Buffer.from(u).toString("hex");
}

describe("verifyDiscordSignature", () => {
  const keypair = nacl.sign.keyPair();
  const publicKey = toHex(keypair.publicKey);
  const timestamp = "1700000000";
  const rawBody = JSON.stringify({ type: 1 });

  function sign(ts: string, body: string): string {
    const msg = new TextEncoder().encode(ts + body);
    return toHex(nacl.sign.detached(msg, keypair.secretKey));
  }

  it("accepts a correctly signed request", () => {
    const signature = sign(timestamp, rawBody);
    expect(verifyDiscordSignature({ rawBody, signature, timestamp, publicKey })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = sign(timestamp, rawBody);
    const tampered = JSON.stringify({ type: 2 });
    expect(verifyDiscordSignature({ rawBody: tampered, signature, timestamp, publicKey })).toBe(false);
  });

  it("rejects a tampered timestamp (replay guard)", () => {
    const signature = sign(timestamp, rawBody);
    expect(verifyDiscordSignature({ rawBody, signature, timestamp: "1700000999", publicKey })).toBe(false);
  });

  it("rejects a missing signature/timestamp", () => {
    expect(verifyDiscordSignature({ rawBody, signature: null, timestamp, publicKey })).toBe(false);
    expect(verifyDiscordSignature({ rawBody, signature: sign(timestamp, rawBody), timestamp: null, publicKey })).toBe(false);
  });

  it("rejects malformed (non-hex) input without throwing", () => {
    expect(verifyDiscordSignature({ rawBody, signature: "zzzz", timestamp, publicKey })).toBe(false);
    expect(verifyDiscordSignature({ rawBody, signature: "abcd", timestamp, publicKey: "nothex" })).toBe(false);
  });

  it("rejects a signature made with a different key", () => {
    const other = nacl.sign.keyPair();
    const msg = new TextEncoder().encode(timestamp + rawBody);
    const signature = toHex(nacl.sign.detached(msg, other.secretKey));
    expect(verifyDiscordSignature({ rawBody, signature, timestamp, publicKey })).toBe(false);
  });
});
