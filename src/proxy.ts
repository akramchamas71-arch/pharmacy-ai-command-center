import { NextRequest, NextResponse } from "next/server";

// Next.js 16 convention: proxy.ts (not middleware.ts — see
// https://nextjs.org/docs/app/guides/upgrading/version-16#middleware-to-proxy). Kept
// deliberately cheap: is there a plausible session cookie at all? The real verification
// (signature, expiry, permission) stays in lib/auth.ts + lib/rbac.ts inside each route
// handler — this layer only rejects obviously unauthenticated requests early and keeps
// `/api/auth/*` reachable.
const SESSION_COOKIE_NAME = "pacc_session";

const PUBLIC_API_PATHS = ["/api/auth/login", "/api/auth/logout", "/api/auth/me"];

// Meta calls this with no session cookie at all — authenticity comes from the
// X-Hub-Signature-256 header instead, verified inside the route itself
// (src/lib/whatsapp.ts verifyWebhookSignature(), checked before anything else runs). The
// GET handshake (hub.verify_token) is similarly its own, separate check in that route.
// /api/shop/*: the customer app — its own cookie (carelink_customer), checked in every route.
const PUBLIC_API_PATH_PREFIXES = ["/api/whatsapp/webhook", "/api/webhook/whatsapp", "/api/shop/"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (PUBLIC_API_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
