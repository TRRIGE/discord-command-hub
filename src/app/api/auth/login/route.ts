import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth-password";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-session";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let email = "";
  let password = "";
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    email = (body.email ?? "").trim().toLowerCase();
    password = body.password ?? "";
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!email || !password) {
    return Response.json({ error: "Email and password required" }, { status: 400 });
  }

  const user = await prisma.adminUser.findUnique({ where: { email } });
  // Always run a verify to keep timing roughly constant even when user is null.
  const ok = user ? verifyPassword(password, user.passwordHash) : false;

  if (!user || !ok) {
    log.warn("auth.login_failed", { email });
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken({ sub: user.id, email: user.email });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
  log.info("auth.login_ok", { email });
  return Response.json({ ok: true });
}
