import catalog from "@/data/lattafa-catalog.json";

/**
 * Lattafa / partner-company catalog for the shop's «لطافة» tab — from the distributor's price list
 * (PCC_PHRevised26_NEW_PRICES.xlsx, prices from 1 Aug 2026). `price` is the customer price TTC
 * (retail + 11% VAT) in USD, as the owner chose. To update prices, regenerate src/data/lattafa-catalog.json.
 */
export interface LattafaItem {
  id: string;
  brand: string;
  brandKey: string;
  name: string;
  size: string;
  code: string | null;
  barcode: string | null;
  price: number;
  isNew: boolean;
  image: string | null;
}

export const LATTAFA_CATALOG = catalog as LattafaItem[];
const byId = new Map(LATTAFA_CATALOG.map((i) => [i.id, i]));

export function getLattafaItem(id: string): LattafaItem | undefined {
  return byId.get(id);
}
