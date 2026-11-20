"use client";

import type { WhatsappMessageDto } from "./types";
import { formatBubbleTime, messageLabel } from "./format";

export function MessageBubble({ message }: { message: WhatsappMessageDto }) {
  const isOutbound = message.direction === "OUTBOUND";
  const isPlaceholder = message.type !== "TEXT";

  return (
    // In this RTL page (html dir="rtl"), flex's logical "start" is the right edge — so
    // "our own" outbound messages (AI or human) sit on the right via justify-start, and
    // the customer's inbound messages sit on the left via justify-end, matching how
    // WhatsApp itself reads in Arabic.
    <div className={`flex ${isOutbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[75%] rounded-3xl border-2 border-ink px-4 py-2.5 text-sm ${
          isOutbound ? "bg-brand-600 text-white shadow-[0_2px_0_#1d2b4f]" : "bg-white text-slate-800 shadow-[0_2px_0_#1d2b4f]"
        } ${isPlaceholder ? "italic opacity-90" : ""}`}
      >
        {message.type === "IMAGE" && message.content.startsWith("data:image/") ? (
          // Prescription photo uploaded from the CareLink app.
          // eslint-disable-next-line @next/next/no-img-element
          <a href={message.content} target="_blank" rel="noreferrer">
            <img src={message.content} alt="صورة الوصفة" className="max-h-64 rounded-2xl border-2 border-ink" />
          </a>
        ) : (
          <p className="whitespace-pre-wrap break-words">{messageLabel(message)}</p>
        )}
        <p className={`mt-1 text-[11px] ${isOutbound ? "text-brand-100" : "text-slate-400"}`}>
          {message.direction === "OUTBOUND" ? "صادرة" : "واردة"} · {formatBubbleTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
