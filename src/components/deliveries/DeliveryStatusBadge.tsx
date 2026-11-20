import { Badge } from "@/components/ui";
import { DELIVERY_STATUS_TONES, deliveryStatusLabel, type DeliveryStatus } from "./deliveryTypes";

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus | string }) {
  const tone = DELIVERY_STATUS_TONES[status as DeliveryStatus] ?? "neutral";
  return <Badge tone={tone}>{deliveryStatusLabel(status)}</Badge>;
}
