import { Badge } from "@/components/ui";
import { ORDER_STATUS_TONES, orderStatusLabel, type OrderStatus } from "./orderTypes";

export function OrderStatusBadge({ status }: { status: OrderStatus | string }) {
  const tone = ORDER_STATUS_TONES[status as OrderStatus] ?? "neutral";
  return <Badge tone={tone}>{orderStatusLabel(status)}</Badge>;
}
