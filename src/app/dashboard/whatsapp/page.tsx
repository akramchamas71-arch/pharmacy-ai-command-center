"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/apiClient";
import { useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import { Alert, Card, CardBody, FullPageSpinner, PageHeader } from "@/components/ui";
import { ConversationList } from "@/components/whatsapp/ConversationList";
import { ThreadPanel } from "@/components/whatsapp/ThreadPanel";
import type {
  BranchDto,
  ConversationDetailDto,
  ConversationScalarDto,
  ConversationStatus,
  ConversationSummaryDto,
  WhatsappMessageDto,
} from "@/components/whatsapp/types";

const POLL_INTERVAL_MS = 9000;

function sortByUpdatedAtDesc(list: ConversationSummaryDto[]): ConversationSummaryDto[] {
  return [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export default function WhatsAppInboxPage() {
  const canSend = useHasPermission(PERMISSION_KEYS.WHATSAPP_SEND);
  const canTakeover = useHasPermission(PERMISSION_KEYS.WHATSAPP_TAKEOVER);

  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "">("");
  const [conversations, setConversations] = useState<ConversationSummaryDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Deep link from «الاستشارات»: /dashboard/whatsapp?c=<conversationId>
  useEffect(() => {
    try {
      const c = new URLSearchParams(window.location.search).get("c");
      if (c) setSelectedId(c);
    } catch {}
  }, []);
  const [conversationDetail, setConversationDetail] = useState<ConversationDetailDto | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const [branches, setBranches] = useState<BranchDto[]>([]);

  // Latest values the polling interval reads, so the interval doesn't need to be torn
  // down and recreated every time the filter or selection changes.
  const statusFilterRef = useRef(statusFilter);
  const selectedIdRef = useRef(selectedId);
  statusFilterRef.current = statusFilter;
  selectedIdRef.current = selectedId;

  const fetchConversations = useCallback(async (status: ConversationStatus | "") => {
    const qs = new URLSearchParams({ limit: "100" });
    if (status) qs.set("status", status);
    return api.get<{ conversations: ConversationSummaryDto[] }>(`/api/whatsapp/conversations?${qs.toString()}`);
  }, []);

  const fetchThread = useCallback(async (id: string) => {
    return api.get<{ conversation: ConversationDetailDto }>(`/api/whatsapp/conversations/${id}`);
  }, []);

  // Initial + filter-change load of the conversation list.
  useEffect(() => {
    if (!canSend) return;
    let cancelled = false;
    setListError(null);
    fetchConversations(statusFilter)
      .then((d) => {
        if (!cancelled) setConversations(d.conversations);
      })
      .catch((e) => {
        if (!cancelled) setListError(e instanceof Error ? e.message : "فشل تحميل المحادثات");
      });
    return () => {
      cancelled = true;
    };
  }, [canSend, statusFilter, fetchConversations]);

  // Branch names, fetched once — WhatsappConversation only stores assignedBranchId, with
  // no nested branch relation, so this map is how the thread header shows a branch name.
  useEffect(() => {
    if (!canSend) return;
    let cancelled = false;
    api
      .get<{ branches: BranchDto[] }>("/api/branches")
      .then((d) => {
        if (!cancelled) setBranches(d.branches);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canSend]);

  // Load the full thread whenever the selected conversation changes.
  useEffect(() => {
    if (!selectedId) {
      setConversationDetail(null);
      return;
    }
    let cancelled = false;
    setConversationDetail(null);
    setLoadingThread(true);
    setThreadError(null);
    fetchThread(selectedId)
      .then((d) => {
        if (!cancelled) setConversationDetail(d.conversation);
      })
      .catch((e) => {
        if (!cancelled) setThreadError(e instanceof Error ? e.message : "فشل تحميل المحادثة");
      })
      .finally(() => {
        if (!cancelled) setLoadingThread(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, fetchThread]);

  // Poll the list and the open thread on a plain interval — no WebSocket infra in this
  // project. Silent: failures here don't clear what's already on screen.
  useEffect(() => {
    if (!canSend) return;
    const interval = setInterval(() => {
      fetchConversations(statusFilterRef.current)
        .then((d) => setConversations(d.conversations))
        .catch(() => {});
      const id = selectedIdRef.current;
      if (id) {
        fetchThread(id)
          .then((d) => setConversationDetail((prev) => (prev && prev.id === id ? d.conversation : prev)))
          .catch(() => {});
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [canSend, fetchConversations, fetchThread]);

  function patchConversationEverywhere(scalar: ConversationScalarDto) {
    setConversationDetail((prev) => (prev && prev.id === scalar.id ? { ...prev, ...scalar } : prev));
    setConversations((prev) =>
      prev ? sortByUpdatedAtDesc(prev.map((c) => (c.id === scalar.id ? { ...c, ...scalar } : c))) : prev
    );
  }

  async function handleTakeover(id: string) {
    const { conversation } = await api.post<{ conversation: ConversationScalarDto }>(
      `/api/whatsapp/conversations/${id}/takeover`
    );
    patchConversationEverywhere(conversation);
  }

  async function handleReturnToAI(id: string) {
    const { conversation } = await api.post<{ conversation: ConversationScalarDto }>(
      `/api/whatsapp/conversations/${id}/return-to-ai`
    );
    patchConversationEverywhere(conversation);
  }

  async function handleTransfer(id: string) {
    const { conversation } = await api.post<{ conversation: ConversationScalarDto }>(
      `/api/whatsapp/conversations/${id}/transfer-to-pharmacist`
    );
    patchConversationEverywhere(conversation);
  }

  async function handleClose(id: string) {
    const { conversation } = await api.post<{ conversation: ConversationScalarDto }>(
      `/api/whatsapp/conversations/${id}/close`
    );
    patchConversationEverywhere(conversation);
  }

  async function handleSend(id: string, text: string) {
    const { message } = await api.post<{ message: WhatsappMessageDto }>("/api/whatsapp/send", {
      conversationId: id,
      text,
    });
    setConversationDetail((prev) => (prev && prev.id === id ? { ...prev, messages: [...prev.messages, message] } : prev));
    setConversations((prev) =>
      prev
        ? sortByUpdatedAtDesc(prev.map((c) => (c.id === id ? { ...c, messages: [message], updatedAt: message.createdAt } : c)))
        : prev
    );
  }

  if (!canSend) {
    return (
      <div>
        <PageHeader title="محادثات واتساب" description="صندوق الوارد لمحادثات العملاء عبر واتساب" />
        <Card>
          <CardBody>
            <Alert tone="warning">ليس لديك صلاحية الوصول إلى محادثات واتساب.</Alert>
          </CardBody>
        </Card>
      </div>
    );
  }

  const branchName = conversationDetail?.assignedBranchId
    ? branches.find((b) => b.id === conversationDetail.assignedBranchId)?.name ?? null
    : null;

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col md:h-[calc(100vh-7rem)]">
      <PageHeader title="محادثات واتساب" description="صندوق الوارد لمحادثات العملاء عبر واتساب — عادية أو عبر كير لينك" />

      {listError && (
        <div className="mb-3">
          <Alert tone="danger">{listError}</Alert>
        </div>
      )}
      {threadError && (
        <div className="mb-3">
          <Alert tone="danger">{threadError}</Alert>
        </div>
      )}

      {conversations === null ? (
        <FullPageSpinner label="جارِ تحميل المحادثات..." />
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* Phone: one pane at a time — the list, or the open conversation with a back button. */}
          <div className={`${selectedId ? "hidden md:flex" : "flex"} min-h-0 w-full md:w-auto`}>
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={setSelectedId}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
          />
          </div>
          <div className={`${selectedId ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col gap-2`}>
          {selectedId && (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="self-start rounded-full border-2 border-ink bg-white px-4 py-1.5 text-sm font-bold text-slate-700 shadow-[0_2px_0_#1d2b4f] md:hidden"
            >
              → رجوع إلى المحادثات
            </button>
          )}
          <ThreadPanel
            conversation={conversationDetail}
            loadingThread={loadingThread}
            branchName={branchName}
            canTakeover={canTakeover}
            canSend={canSend}
            onTakeover={handleTakeover}
            onReturnToAI={handleReturnToAI}
            onTransfer={handleTransfer}
            onClose={handleClose}
            onSend={handleSend}
          />
          </div>
        </div>
      )}
    </div>
  );
}
