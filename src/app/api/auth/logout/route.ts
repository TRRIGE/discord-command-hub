import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth-session";

export const runtime = "nodejs";

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
