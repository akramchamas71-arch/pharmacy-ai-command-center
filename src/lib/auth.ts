import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

if (!JWT_SECRET) {
  // Fail loudly at import time rather than silently signing tokens with `undefined`.
  throw new Error(
    "JWT_SECRET is not set. Copy .env.example to .env and set a real secret (openssl rand -base64 48)."
  );
}

export interface SessionPayload {
  userId: string;
  roleId: string;
  roleName: string;
  branchId: string | null;
}

export async function hashPassword(plain: string): Promise<string> {
  // 12 rounds: a deliberate cost/latency tradeoff for an admin-facing login, not a
  // high-throughput endpoint. Revisit if login volume ever makes this a bottleneck.
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signSession(payload: SessionPayload): string {
  // @types/jsonwebtoken types `expiresIn` as a narrow literal-string union (e.g. "12h") or
  // a number of seconds, so an env-sourced plain string needs an explicit cast here — the
  // runtime (the `ms` package) accepts any string in that format regardless.
  const options: jwt.SignOptions = { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] };
  return jwt.sign(payload, JWT_SECRET as string, options);
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET as string) as SessionPayload;
  } catch {
    // Expired, tampered, or malformed — all treated the same: no session.
    return null;
  }
}

export const SESSION_COOKIE_NAME = "pacc_session";
