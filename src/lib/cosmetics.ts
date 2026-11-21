import catalog from "@/data/cosmetics-catalog.json";

/**
 * Cosmetics / para-pharmacy catalog for the shop's «كوزماتيك» tab. Built from the pharmacies' stock
 * (prisma/real-data/inventoryData.json), classified دواء/بارا by name (MoH registered-drug list +
 * brand/keyword rules) and approved by the owner on 2026-11-21.
 *
 * - `raw` is the exact Product.name in the database (used to find the product + live stock).
 * - `price` is the customer SELLING price in USD = the LOWEST selling price among the pharmacies.
 *   It is null until the selling-price export from SoftPharm arrives (the DB inventory price is a
 *   COST price and must never be shown to customers). While null, the pharmacy confirms the price.
 * - `image` is a path under /public (cosmetic photos to be supplied by the owner).
 */
export interface CosmeticItem {
  id: string;
  raw: string;
  name: string;
  cat: string;
  price: number | null;
  image: string | null;
}

export const COSMETIC_CATEGORIES: { key: string; label: string }[] = [
  { key: "skin", label: "🧴 عناية بالبشرة" },
  { key: "makeup", label: "💄 مكياج" },
  { key: "perfume", label: "🌸 عطور ومزيلات" },
  { key: "hair", label: "💇 شعر" },
  { key: "baby", label: "👶 أطفال وحليب" },
  { key: "body", label: "🛁 عناية شخصية" },
  { key: "dental", label: "🦷 أسنان" },
  { key: "devices", label: "🩺 أجهزة ومستلزمات" },
  { key: "food", label: "🥣 أغذية" },
];

export const COSMETICS = catalog as CosmeticItem[];
export const COSMETIC_RAW_NAMES = new Set(COSMETICS.map((i) => i.raw.replace(/\s+/g, " ").trim().toUpperCase()));
