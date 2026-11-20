"use client";

import { Badge, Select } from "@/components/ui";
import type { ConversationStatus, ConversationSummaryDto } from "./types";
import { formatListTimestamp, messageLabel } from "./format";

const STATUS_OPTIONS: { value: ConversationStatus | ""; label: string }[] = [
  { value: "", label: "كل المحادثات" },
  { value: "OPEN", label: "مفتوحة" },
  { value: "TRANSFERRED_TO_PHARMACIST", label: "محوّلة لصيدلي" },
  { value: "CLOSED", label: "مغلقة" },
];

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  statusFilter,
  onStatusFilterChange,
}: {
  conversations: ConversationSummaryDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusFilter: ConversationStatus | "";
  onStatusFilterChange: (status: ConversationStatus | "") => void;
}) {
  return (
    <div className="flex h-full w-full shrink-0 flex-col md:w-80 overflow-hidden rounded-3xl border-[2.5px] border-ink bg-white shadow-pop">
      <div className="border-b-2 border-dashed border-slate-300 p-3">
        <Select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value as ConversationStatus | "")}
          aria-label="تصفية حسب الحالة"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-slate-400">لا توجد محادثات مطابقة</p>
        ) : (
          conversations.map((conv) => {
            const isSelected = conv.id === selectedId;
            const lastMessage = conv.messages[0];
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv.id)}
                className={`block w-full border-b border-dashed border-slate-300 px-4 py-3 text-right transition-colors ${
                  isSelected ? "bg-sun/40" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${isSelected ? "font-bold text-brand-800" : "font-semibold text-slate-800"}`}>
                    {conv.customer.name || conv.customer.phone}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{formatListTimestamp(conv.updatedAt)}</span>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">{lastMessage ? messageLabel(lastMessage) : "لا توجد رسائل بعد"}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  {conv.channel === "CARELINK" && <Badge tone="info">كير لينك</Badge>}
                  <Badge tone={conv.assignedAgent === "HUMAN" ? "brand" : "neutral"}>
                    {conv.assignedAgent === "HUMAN" ? "بشري" : "ذكاء اصطناعي"}
                  </Badge>
                  {conv.status === "TRANSFERRED_TO_PHARMACIST" && <Badge tone="warning">لدى الصيدلي</Badge>}
                  {conv.status === "CLOSED" && <Badge tone="neutral">مغلقة</Badge>}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
