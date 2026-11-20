import { phoneDigits } from "@/lib/whatsapp";

/**
 * Who delivers for which pharmacy — the real arrangement the owner gave (also in
 * prisma/real-data/seedRealBranches.ts):
 *  - Beirut pharmacies (الرسول، يحيى، فارماكير، طالب): one shared delivery company, شركة المختار.
 *  - صيدلية الجواد كير (بعلبك): its own delivery person.
 *  - صيدلية العاصي (الهرمل): its own delivery person.
 *
 * The database field Branch.specialDeliveryContactWhatsapp is the source of truth. This table is
 * only a safety net for when that field is still empty in the live database (the seed script was
 * never run there), so the flow does not depend on a manual step. It never overrides a value
 * that is already stored.
 */
const KNOWN_DELIVERY: { match: string[]; whatsapp: string; label: string | null }[] = [
  { match: ["الرسول", "يحيى", "فارماكير", "طالب"], whatsapp: "+96171030940", label: "شركة المختار" },
  { match: ["الجواد"], whatsapp: "+96181501394", label: "ديلفري الجواد كير" },
  { match: ["العاصي"], whatsapp: "+96176324551", label: "ديلفري العاصي" },
];

export interface BranchDeliveryInput {
  name: string;
  specialDeliveryContactWhatsapp?: string | null;
  specialDeliveryContactLabel?: string | null;
}

export function resolveBranchDeliveryContact(
  branch: BranchDeliveryInput
): { whatsapp: string; label: string | null; source: "branch" | "known" | "env" } | null {
  if (branch.specialDeliveryContactWhatsapp) {
    return {
      whatsapp: branch.specialDeliveryContactWhatsapp,
      label: branch.specialDeliveryContactLabel ?? null,
      source: "branch",
    };
  }
  const known = KNOWN_DELIVERY.find((k) => k.match.some((m) => branch.name.includes(m)));
  if (known) return { whatsapp: known.whatsapp, label: known.label, source: "known" };
  // Last resort: a general CareLink delivery line, only if the owner configured one AND it is not
  // the CareLink customer-facing number itself (messaging yourself never works).
  const general = process.env.CARELINK_DELIVERY_CONTACT_WHATSAPP;
  if (general && phoneDigits(general) !== phoneDigits(process.env.CARELINK_CONTACT_WHATSAPP)) {
    return { whatsapp: general, label: "Carelink ديلفري", source: "env" };
  }
  return null;
}

/** Digits of every number that is a delivery contact (stored or known) — used to recognise their replies. */
export function knownDeliveryDigits(): string[] {
  return KNOWN_DELIVERY.map((k) => phoneDigits(k.whatsapp));
}
