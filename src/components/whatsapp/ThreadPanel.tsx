"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, EmptyState, FullPageSpinner, Textarea } from "@/components/ui";
import type { ConversationDetailDto } from "./types";
import { MessageBubble } from "./MessageBubble";
import { ApiError } from "@/lib/apiClient";

type ActionKey = "takeover" | "return" | "transfer" | "close";

export function ThreadPanel({
  conversation,
  loadingThread,
  branchName,
  canTakeover,
  canSend,
  onTakeover,
  onReturnToAI,
  onTransfer,
  onClose,
  onSend,
}: {
  conversation: ConversationDetailDto | null;
  loadingThread: boolean;
  branchName?: string | null;
  canTakeover: boolean;
  canSend: boolean;
  onTakeover: (id: string) => Promise<void>;
  onReturnToAI: (id: string) => Promise<void>;
  onTransfer: (id: string) => Promise<void>;
  onClose: (id: string) => Promise<void>;
  onSend: (id: string, text: string) => Promise<void>;
}) {
  const [actionPending, setActionPending] = useState<ActionKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActionError(null);
    setSendError(null);
    setComposerText("");
  }, [conversation?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [conversation?.messages.length, conversation?.id]);

  if (loadingThread) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-3xl border-[2.5px] border-ink bg-white shadow-pop">
        <FullPageSpinner label="جارِ تحميل المحادثة..." />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full flex-1 items-center justify-center rounded-3xl border-[2.5px] border-ink bg-white shadow-pop">
        <EmptyState title="اختر محادثة من القائمة" description="اختر محادثة من القائمة على اليمين لعرض الرسائل والرد عليها." />
      </div>
    );
  }

  const conversationId = conversation.id;

  async function runAction(key: ActionKey, fn: (id: string) => Promise<void>) {
    setActionPending(key);
    setActionError(null);
    try {
      await fn(conversationId);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "حدث خطأ غير متوقع");
    } finally {
      setActionPending(null);
    }
  }

  async function handleSend() {
    const text = composerText.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(conversationId, text);
      setComposerText("");
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : "حدث خطأ غير متوقع أثناء الإرسال");
    } finally {
      setSending(false);
    }
  }

  const isClosed = conversation.status === "CLOSED";
  const isTransferred = conversation.status === "TRANSFERRED_TO_PHARMACIST";

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden rounded-3xl border-[2.5px] border-ink bg-white shadow-pop">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-dashed border-slate-300 px-3 py-3 md:px-5 md:py-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800">{conversation.customer.name || conversation.customer.phone}</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {conversation.customer.phone}
            {branchName ? ` · فرع ${branchName}` : ""}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            {conversation.channel === "CARELINK" && <Badge tone="info">كير لينك</Badge>}
            <Badge tone={conversation.assignedAgent === "HUMAN" ? "brand" : "neutral"}>
              {conversation.assignedAgent === "HUMAN" ? "بشري" : "ذكاء اصطناعي"}
            </Badge>
            <Badge
              tone={isClosed ? "neutral" : isTransferred ? "warning" : "success"}
            >
              {isClosed ? "مغلقة" : isTransferred ? "لدى الصيدلي" : "مفتوحة"}
            </Badge>
          </div>
        </div>

        {canTakeover && (
          <div className="flex flex-wrap items-center gap-2">
            {conversation.assignedAgent === "AI" && !isClosed && (
              <Button
                size="sm"
                variant="outline"
                disabled={actionPending !== null}
                loading={actionPending === "takeover"}
                onClick={() => runAction("takeover", onTakeover)}
              >
                تولي المحادثة
              </Button>
            )}
            {conversation.assignedAgent === "HUMAN" && !isClosed && (
              <Button
                size="sm"
                variant="secondary"
                disabled={actionPending !== null}
                loading={actionPending === "return"}
                onClick={() => runAction("return", onReturnToAI)}
              >
                إعادة للذكاء الاصطناعي
              </Button>
            )}
            {!isTransferred && !isClosed && (
              <Button
                size="sm"
                variant="outline"
                disabled={actionPending !== null}
                loading={actionPending === "transfer"}
                onClick={() => {
                  if (window.confirm("هل تريد تحويل هذه المحادثة إلى صيدلي مختص؟ يُستخدم هذا عندما تتضمن المحادثة استشارة دوائية أو طلب دواء يتطلب تدخل صيدلي.")) {
                    runAction("transfer", onTransfer);
                  }
                }}
              >
                تحويل لصيدلي
              </Button>
            )}
            {!isClosed && (
              <Button
                size="sm"
                variant="danger"
                disabled={actionPending !== null}
                loading={actionPending === "close"}
                onClick={() => {
                  if (window.confirm("هل تريد إغلاق هذه المحادثة؟ لا يمكن إعادة فتحها بعد الإغلاق.")) {
                    runAction("close", onClose);
                  }
                }}
              >
                إغلاق المحادثة
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError && (
        <div className="px-5 pt-3">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3 md:px-5 md:py-4">
        {conversation.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">لا توجد رسائل في هذه المحادثة بعد</p>
        ) : (
          conversation.messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      {canSend && (
        <div className="border-t-2 border-dashed border-slate-300 p-3">
          {sendError && (
            <div className="mb-2">
              <Alert tone="danger">{sendError}</Alert>
            </div>
          )}
          {isClosed ? (
            <p className="px-2 py-1.5 text-center text-xs text-slate-400">هذه المحادثة مغلقة ولا يمكن الرد عليها</p>
          ) : (
            <div className="flex items-end gap-2">
              <Textarea
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="اكتب رداً للعميل..."
                rows={2}
                className="flex-1 resize-none"
                disabled={sending}
              />
              <Button onClick={handleSend} loading={sending} disabled={sending || !composerText.trim()}>
                إرسال
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
