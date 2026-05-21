import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Lightweight gate for /login and /console/*. The HttpOnly cookies are set by
 * /api/auth/login and /api/auth/signup; we only need to know if any access
 * token exists. We also accept the shadow cookie set by the client-side auth
 * module (which is just a mirror of the access token — used so the middleware
 * stays trivial without running the encryption layer).
 */
export function middleware(request: NextRequest) {
  const access =
    request.cookies.get("sb-access-token")?.value ||
    request.cookies.get("sb-access-shadow")?.value;
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/console") && !access) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/login" && access) {
    return NextResponse.redirect(new URL("/console", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/console/:path*"],
};
