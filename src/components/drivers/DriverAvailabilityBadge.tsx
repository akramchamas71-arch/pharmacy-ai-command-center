import { Badge } from "@/components/ui";
import { DRIVER_AVAILABILITY_TONES, driverAvailabilityLabel, type DriverAvailability } from "./driverTypes";

export function DriverAvailabilityBadge({ availability }: { availability: DriverAvailability | string }) {
  const tone = DRIVER_AVAILABILITY_TONES[availability as DriverAvailability] ?? "neutral";
  return <Badge tone={tone}>{driverAvailabilityLabel(availability)}</Badge>;
}
