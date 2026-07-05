import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth-session";

/**
 * Gate the dashboard behind login. Runs on the edge; only verifies the JWT
 * (no DB, no crypto password work). Unauthenticated users are redirected to
 * /login. The interactions endpoint and auth routes are intentionally public.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Redirect-guard the dashboard pages only. The dashboard API routes
  // (/api/config, /api/servers, /api/actions) self-guard with a JSON 401 via
  // getSession(), which is the right behavior for an API client. The
  // interactions endpoint and auth routes are intentionally public.
  matcher: ["/dashboard/:path*"],
};
