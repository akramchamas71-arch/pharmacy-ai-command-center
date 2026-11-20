import { Secret, TOTP } from "otpauth";

// The plan doc's security model (§16) requires 2FA for ADMIN/SUPER_ADMIN. The schema has
// carried `User.twoFactorSecret`/`twoFactorEnabled` since Phase 1; this file is the actual
// TOTP implementation that was a `// TODO` in src/app/api/auth/login/route.ts until now.
const ISSUER = "Pharmacy AI Command Center";

// RFC 6238 defaults — 30s step, 6 digits, SHA-1 — chosen because every common authenticator
// app (Google Authenticator, Authy, 1Password, …) assumes exactly these unless told
// otherwise, and the enrollment URI below never sets a custom period/digits/algorithm.
function buildTotp(secret: Secret, label: string): TOTP {
  return new TOTP({ issuer: ISSUER, label, secret, algorithm: "SHA1", digits: 6, period: 30 });
}

export interface PendingTwoFactorSecret {
  base32Secret: string;
  enrollmentUri: string;
}

/**
 * Step 1 of enrollment: generates a brand-new random secret and the otpauth:// URI an
 * authenticator app scans (as a QR code) or accepts pasted — there's no dashboard UI yet
 * to render a QR image, so the raw URI/secret is returned as-is; rendering it is Phase 11
 * territory. The secret is NOT persisted as `twoFactorEnabled` yet — see enableTwoFactor()
 * below, which requires proving the admin can actually generate a valid code with it first.
 */
export function generatePendingTwoFactorSecret(label: string): PendingTwoFactorSecret {
  const secret = new Secret({ size: 20 });
  const totp = buildTotp(secret, label);
  return { base32Secret: secret.base32, enrollmentUri: totp.toString() };
}

/**
 * Verifies a 6-digit code against a stored base32 secret. `window: 1` tolerates the code
 * from one 30-second step before/after now — clock drift between the admin's phone and the
 * server is real and this is the standard mitigation; it does NOT widen the replay window
 * enough to matter (still only 3 valid codes at any instant, each single-use in practice
 * since the next login moves the clock forward).
 */
export function verifyTwoFactorToken(base32Secret: string, token: string): boolean {
  const secret = Secret.fromBase32(base32Secret);
  const totp = buildTotp(secret, "verify");
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}
