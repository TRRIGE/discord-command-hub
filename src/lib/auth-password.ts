import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt — no native deps. Node-only: keep this out of
 * anything that gets bundled for the edge runtime (e.g. middleware).
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const derived = scryptSync(password, salt, expected.length);
  // Constant-time comparison to avoid timing leaks.
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
