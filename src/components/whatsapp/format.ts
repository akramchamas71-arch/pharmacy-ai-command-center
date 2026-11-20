import type { WhatsappMessageDto } from "./types";

/** A short, Arabic-friendly label for a message preview or placeholder bubble when the
 * message isn't plain TEXT — there's no media URL anywhere in the schema to actually
 * render an image/audio, so this is deliberately just a labeled stand-in. */
export function messageLabel(message: Pick<WhatsappMessageDto, "type" | "content">): string {
  switch (message.type) {
    case "IMAGE":
      return "📎 صورة";
    case "AUDIO":
      return "📎 رسالة صوتية";
    case "TEMPLATE":
      return `📄 قالب: ${message.content}`;
    case "SYSTEM":
      return `⚙️ رسالة نظام: ${message.content}`;
    case "TEXT":
    default:
      return message.content;
  }
}

/** Short timestamp for the conversation list — time only if today, otherwise a short date. */
export function formatListTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("ar", { day: "numeric", month: "short" });
}

/** Full time for a message bubble (same day is the common case in an active thread). */
export function formatBubbleTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
}
