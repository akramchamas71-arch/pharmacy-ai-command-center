/**
 * Plain string-literal mirror of DriverAvailability from prisma/schema.prisma — see the
 * matching comment in src/components/orders/orderTypes.ts on why this is not imported
 * from "@prisma/client" in this sandbox.
 */
export type DriverAvailability = "AVAILABLE" | "BUSY" | "OFFLINE";

export const DRIVER_AVAILABILITY_LABELS_AR: Record<DriverAvailability, string> = {
  AVAILABLE: "متاح",
  BUSY: "مشغول",
  OFFLINE: "غير متصل",
};

export function driverAvailabilityLabel(availability: string): string {
  return DRIVER_AVAILABILITY_LABELS_AR[availability as DriverAvailability] ?? availability;
}

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export const DRIVER_AVAILABILITY_TONES: Record<DriverAvailability, BadgeTone> = {
  AVAILABLE: "success",
  BUSY: "warning",
  OFFLINE: "neutral",
};

export interface DriverUser {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface Driver {
  id: string;
  userId: string;
  vehicle: string | null;
  availability: DriverAvailability;
  createdAt: string;
  user: DriverUser;
}
