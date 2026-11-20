/**
 * "منطقة البقاع" detection — backs the one new business rule the user gave this session:
 * "في حال كان الطلب من زبون في البقاع فالبحث يكون في [الجواد كير والعاصي] فقط."
 *
 * IMPORTANT geographic correction made directly from the user's own uploaded document (the
 * pharmacy phone-number list), not assumed: صيدلية الجواد كير's real address is "بعلبك - راس
 * العين" (Baalbek) and صيدلية العاصي's is "جسر العاصي... الهرمل" (Hermel) — i.e. both are in the
 * Baalbek-Hermel Governorate, which has been administratively separate from Bekaa Governorate
 * since 2017. The user still calls this whole area "البقاع", which matches how most Lebanese
 * speak day-to-day (the pre-2017 undivided Bekaa is still the common reference). So "Bekaa" in
 * this file — and in the routing rule that uses it — means that colloquial, broader area (Bekaa
 * Governorate + Baalbek-Hermel Governorate), confirmed by these two branches' real addresses,
 * not the narrower post-2017 governorate line. If that's not what the user meant, this list is
 * the one place to correct.
 *
 * Deliberately NOT an AI/LLM guess and NOT a geo-coordinate/distance calculation (Branch has no
 * lat/lng in this schema, only Customer does, per assign_pharmacy's own existing comment on why
 * that kind of invented rule is avoided here). This is a plain, inspectable substring match
 * against real Lebanese place names against the one free-text field that exists for this today:
 * Customer.address. It is a heuristic, not a certainty — flagged in the README as something the
 * user should confirm/extend, and a human CS rep or the AI itself can always override by simply
 * picking a branch directly (see aiTools.ts's handling of an explicit branchId/preferredBranchId
 * outside this detected set).
 */

// Real place names covering Bekaa Governorate and Baalbek-Hermel Governorate (both spellings /
// transliterations where a customer might type either). Keep this list growing as real orders
// come in rather than trying to be exhaustive on day one.
const BEKAA_PLACE_NAMES: string[] = [
  // المصطلح العام
  "بقاع",
  "البقاع",
  "bekaa",
  "beqaa",
  "biqa",
  // محافظة بعلبك الهرمل (عناوين الجواد كير والعاصي الحقيقية)
  "بعلبك",
  "baalbek",
  "baalbeck",
  "الهرمل",
  "hermel",
  "راس العين",
  "ras el ain",
  "ras baalbek",
  "رأس بعلبك",
  // محافظة البقاع (زحلة وما حولها)
  "زحلة",
  "zahle",
  "zahleh",
  "شتورا",
  "chtaura",
  "ستورة",
  "البقاع الغربي",
  "west bekaa",
  "راشيا",
  "rachaya",
  "جب جنين",
  "jib jannine",
  "qab elias",
  "قب الياس",
  "بر الياس",
  "bar elias",
  "عنجر",
  "anjar",
  "المصنع",
  "masnaa",
  "دير الأحمر",
  "deir el ahmar",
];

const normalize = (text: string): string =>
  text
    .toLowerCase()
    // Arabic alef/ya variants so "إلى"/"الى"، "بقاع"/"البقاع" etc. match consistently.
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");

/**
 * Returns true when `address` plainly names a Bekaa/Baalbek-Hermel location (see the module
 * comment for exactly which real places that covers). `null`/empty/unmatched address → false —
 * absence of a match is "not known to be Bekaa", never silently treated as a Bekaa order.
 */
export function isLikelyBekaaAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const normalizedAddress = normalize(address);
  return BEKAA_PLACE_NAMES.some((place) => normalizedAddress.includes(normalize(place)));
}
