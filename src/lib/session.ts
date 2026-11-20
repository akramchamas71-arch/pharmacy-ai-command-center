import { NextRequest } from "next/server";
import { verifySession, SESSION_COOKIE_NAME, SessionPayload } from "@/lib/auth";

/**
 * Reads and verifies the session cookie off an API route's request. Returns null for
 * "not logged in" — every caller treats null the same way it would treat a verified
 * session lacking the right permission (401/403), never as a reason to skip a check.
 *
 * This is the one place Phase 2+ route handlers pull the caller's identity from, instead
 * of each route re-inlining the cookie-read + verifySession() pair (the pattern that was
 * duplicated in Phase 1's auth/me route).
 */
export function getSession(req: NextRequest): SessionPayload | null {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}
