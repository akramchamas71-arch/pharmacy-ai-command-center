import { prisma } from "@/lib/prisma";

// Not a human's credential and not an env var like SEED_SUPERADMIN_EMAIL on purpose — this
// account is infrastructure (the AI Orchestrator's fixed identity), so it's always seeded
// unconditionally by prisma/seed.ts with active: false, which blocks it from ever logging in
// via POST /api/auth/login. Exported from here (not duplicated in seed.ts) so there is exactly
// one source of truth for the address both files need.
export const AI_SYSTEM_EMAIL = "ai-orchestrator@internal.pharmacy-ai";

/**
 * The identity every AI Tool call (src/lib/aiTools.ts) acts as — its userId/roleId feed the
 * exact same hasPermission() choke point and audit trail (src/lib/audit.ts) a human-driven
 * API route uses, per the plan doc's AI rules ("كل Tool يتحقق قبل التنفيذ من: authentication،
 * permissions…") and rbac.ts's own hasPermission() comment: "every Tool re-validates
 * permissions here rather than trusting the caller's claims." Throws (via findUniqueOrThrow)
 * if prisma/seed.ts hasn't run yet — there is no silent "AI has no identity" fallback.
 */
export async function getAiSystemUser() {
  return prisma.user.findUniqueOrThrow({ where: { email: AI_SYSTEM_EMAIL } });
}
