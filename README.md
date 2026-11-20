# PHARMACY AI COMMAND CENTER — Phase 1 + 2 + 3 + 4 + 6 + 9 (+ Phase 5 prep)

**Phase 1: Database + Authentication + Roles. Phase 2: Branches + Products + Inventory.
Phase 3: Orders + Reservations. Phase 4: WhatsApp integration. Phase 6: Delivery
Management. Phase 9: Reports and Analytics.** Phase 5 (AI Customer Service) is built and
type-checked but not live yet — see "What's prepared for Phase 5" below. This is 6 of 10
phases from the project plan (see the linked doc for the full architecture, schema
rationale, and the open decisions needed before later phases). Completely independent of
the existing claude.ai/Cloudflare pharmacy dashboard — no shared code, no shared database.

## Hosting & storage decision (made this session) — see DEPLOY.md

Two of the plan doc's long-open decisions are now resolved: the app runs on **Railway**
(plain Node.js, zero code changes — Prisma's native engine needs a real Node runtime, which
rules out running this specific app ON Cloudflare Workers without a much larger, unverifiable
rewrite), its **Postgres** database is a Railway-managed instance, and Phase 8's file storage
is **Cloudflare R2** (`src/lib/storage.ts`'s `R2Adapter` — real `@aws-sdk/client-s3`, no
invented client). Full step-by-step deploy instructions: **`DEPLOY.md`**. None of this has
been exercised against a live deploy from this sandbox — see `DEPLOY.md`'s own note and
"Known limitation in THIS sandbox" below for exactly why, and what was verified instead
(`tsc --noEmit` against the real `@aws-sdk/client-s3` types, zero errors).

## What's in Phase 1

- **Prisma schema** (`prisma/schema.prisma`) — every table from the plan doc: users, roles,
  permissions, branches, employees, customers, products, inventory, inventory_transactions,
  orders, order_items, reservations, deliveries, drivers, whatsapp_conversations,
  whatsapp_messages, documents, carelink_jobs, notifications, audit_logs.
- **Auth**: email/phone + password login, bcrypt hashing, JWT session in an httpOnly cookie
  (`src/lib/auth.ts`, `src/app/api/auth/*`).
- **RBAC**: 8 roles seeded with a starter permission set (`prisma/seed.ts`,
  `src/lib/rbac.ts`) — `hasPermission()` is the one choke point every future API route and
  every AI Tool (Phase 5) must call before acting, per the plan doc's security model.
- **Route protection**: `src/proxy.ts` (Next.js 16's renamed `middleware.ts` convention)
  rejects unauthenticated requests to any `/api/*` route except the auth endpoints
  themselves.

## What's in Phase 2

- **`lowStockThreshold`** added to `Inventory` (default 10) — drives the low-stock alert
  queries the plan doc's Admin Dashboard and Reports module both need.
- **Two new permissions** (`src/lib/rbac.ts`): `BRANCHES_MANAGE`, `PRODUCTS_MANAGE`. Both
  flow to SUPER_ADMIN and ADMIN automatically (they're seeded from `Object.values(PERMISSIONS)`)
  — no seed change needed.
- **`src/lib/session.ts`** — `getSession(req)`, the shared cookie-read-and-verify helper.
- **`src/lib/apiGuard.ts`** — `requirePermission(req, permission)`, the one call every route
  below makes before touching data: no session → 401, session but missing the permission →
  403, otherwise returns the session.
- **Business logic** (`src/lib/branches.ts`, `products.ts`, `inventory.ts`, `errors.ts`):
  - Branches: list/get/create/update, plus `disableBranch`/`enableBranch` (the plan doc's
    "remove a branch without code changes" is DISABLED, not a hard delete — history stays
    intact). A real `deleteBranch` is only allowed when nothing real happened at that branch
    yet (no employees, inventory, or orders) — otherwise it throws a `BusinessRuleError`
    telling the caller to disable it instead.
  - Products: case-insensitive search across name/brand/barcode/genericName/activeIngredient
    (deliberately not fuzzy yet — real fuzzy/typo-tolerant matching is Phase 5's AI search
    layer, which can fall back to this same query). `deleteProduct` is blocked the same way
    if the product is already in any branch's inventory or any past order.
  - Inventory: `upsertInventoryMeta` sets price/threshold/expiry for a product-at-branch
    (creates the row the first time a branch stocks it); `adjustInventory` is the **only**
    path that ever changes `qtyOnHand`, atomically paired with an `inventory_transactions`
    row in the same DB transaction, and rejects a result that would go negative or dip below
    `qtyReserved`. `getInventoryAlerts` returns out-of-stock / low-stock / near-expiry lists.
- **API routes**, all permission-checked and branch-scoped via `canAccessBranch()`:
  - `GET/POST /api/branches`, `GET/PATCH/DELETE /api/branches/[id]`
  - `GET/POST /api/products`, `GET/PATCH/DELETE /api/products/[id]`
  - `GET/POST /api/inventory` (POST sets price/threshold/expiry; see below for the
    price-change rule), `POST /api/inventory/adjust` (the only quantity-changing call),
    `GET /api/inventory/alerts`
- **Price changes need `PRICING_WRITE`, not just `INVENTORY_WRITE`.** Setting a product's
  *initial* price while first stocking it at a branch only needs `INVENTORY_WRITE`; changing
  the price on an *existing* inventory row additionally requires `PRICING_WRITE` — per the
  plan doc's §25 human-approval list for price changes. Today `PRICING_WRITE` is only seeded
  for SUPER_ADMIN/ADMIN/ACCOUNTING-equivalent roles that hold it via the "all permissions"
  grant; a dedicated approval *workflow* (as opposed to just a permission gate) is Phase 9+
  territory, noted below under "deliberately not done yet."
- Branch-scoped roles (PHARMACY_MANAGER, PHARMACIST, PHARMACY_EMPLOYEE) can only read or
  write inventory at their own branch — every inventory/adjust/alerts route checks
  `canAccessBranch(session.branchId, targetBranchId)` and returns 403 on a mismatch.

## What's in Phase 3

- **`OrderSequence`** table added to the schema — one row per year, incremented inside the
  same transaction as order creation, backing the plan doc's `ORD-YYYY-NNNNNN` numbering
  (`src/lib/orderNumber.ts`) with no risk of two concurrent orders colliding on a number.
- **`src/lib/customers.ts`** — `findOrCreateCustomerByPhone()` (phone is the customer's
  identity, same as it will be for WhatsApp in Phase 4), `searchCustomers`, `getCustomer`.
- **`src/lib/audit.ts`** — `logAudit()`, writing one `audit_logs` row per sensitive order
  transition (create/confirm/cancel/advance), inside the same DB transaction as the change
  it records.
- **`src/lib/orders.ts`** — the reservation system itself:
  - `createOrder()`: checks every line's availability (`qtyOnHand - qtyReserved`) before
    writing anything (one short item fails the whole order, never a half-reserved cart),
    then atomically creates the order (`PENDING_CONFIRMATION`), its `OrderItem`s, and a
    `HELD` `Reservation` per item with a `RESERVATION_TTL_MINUTES` (15 min) expiry —
    incrementing `qtyReserved` and logging a `RESERVATION_HOLD` transaction for each.
  - `confirmOrder()`: `PENDING_CONFIRMATION -> CONFIRMED`. This is where stock actually
    leaves the branch — `qtyOnHand` and `qtyReserved` drop together (`STOCK_OUT`), every
    reservation moves `HELD -> CONSUMED`. Refuses a reservation whose TTL already passed.
  - `cancelOrder()`: unwinds whatever happened to the stock depending on each reservation's
    state — `HELD` just drops the hold (`RESERVATION_RELEASE`, `qtyReserved` only); `CONSUMED`
    means the stock already left at confirmation, so it's added back to `qtyOnHand`
    (`ADJUSTMENT`, referencing the order) before the reservation is marked `RELEASED`.
    Cancelling an order that's already past `PENDING_CONFIRMATION` requires the caller to
    also hold `ORDERS_CANCEL` — the plan doc's §25 human-approval rule for a confirmed
    order; the route checks this (`hasPermission`), the lib function just takes the
    already-decided `hasApproval` flag.
  - `advanceOrderStatus()`: the post-confirmation fulfillment walk
    `PREPARING -> READY_FOR_DELIVERY -> OUT_FOR_DELIVERY -> DELIVERED`, each step validated
    against a fixed transition map. `CONFIRMED` and `CANCELLED` are deliberately NOT
    reachable through this function — only `confirmOrder()`/`cancelOrder()` carry the stock
    side effects those two transitions need.
  - `releaseExpiredReservations()`: the sweep for holds whose 15-minute TTL ran out before
    anyone confirmed them. **Not wired to a real schedule yet** — that's Phase 10's
    Background Jobs/Queue layer in the plan doc's architecture; for now it's exposed as
    `POST /api/orders/expire-reservations` so it can be called manually, or from any cron
    you set up, until then.
- **API routes**, all permission-checked and branch-scoped:
  - `GET/POST /api/orders`, `GET /api/orders/[id]`
  - `POST /api/orders/[id]/confirm`, `/advance` (body `{"status": "..."}`), `/cancel` (body
    `{"reason"?: "..."}`, 403s if the order is already confirmed and the caller lacks
    `ORDERS_CANCEL`)
  - `POST /api/orders/expire-reservations` (network-wide, not branch-scoped — an expired
    hold anywhere ties up stock everywhere it's seen)
- `PHARMACY_MANAGER` was given `ORDERS_CANCEL` in `prisma/seed.ts` — the plan doc's natural
  local approver for a confirmed-order cancellation at their own branch; `SUPER_ADMIN`/`ADMIN`
  already held it network-wide via the "all permissions" grant.

## What's in Phase 4

**This is the real, documented WhatsApp Business Cloud API** — per the plan doc's hard
rule, never an invented stand-in for an unavailable integration. It needed a decision
first (which number to dedicate, under your Meta Business account) that you don't have yet,
so this phase is built against **Meta's free test number** instead: every Meta Developer
app gets one automatically, with a temporary access token and up to 5 verified recipient
numbers — enough to exercise the entire flow below before the real-number decision is
made. Swapping in your production number later is a config change, not a code change.

- **`src/lib/whatsapp.ts`** — the Cloud API client: `sendTextMessage()` (only works inside
  the 24-hour customer-service window that opens when the customer last messaged) and
  `sendTemplateMessage()` (the only way to message outside that window — the template must
  already be approved in Meta Business Manager). `verifyWebhookSignature()` checks Meta's
  `X-Hub-Signature-256` HMAC against the **raw** request body (never a re-serialized one —
  see the function's own comment for why that would silently break verification).
  `verifyWebhookChallenge()` handles the one-time GET handshake. Nothing here requires its
  env vars to even be set until it's actually called — the rest of the app (Phases 1-3)
  keeps working with WhatsApp totally unconfigured; a missing var throws a clear
  `WhatsAppConfigError`, never a silent no-op.
- **`src/lib/conversations.ts`** — one OPEN conversation per customer at a time (a second
  message from the same customer continues the thread, matching how WhatsApp actually
  behaves); `appendInboundMessage()` is idempotent on `waMessageId` (Meta retries webhook
  delivery on anything but a fast 200, so the same message can legitimately arrive twice);
  `sendReply()` calls the real API first and only persists the message if Meta actually
  accepted it — a failed send never shows up in the thread as if it went out.
  `takeOverConversation()` / `returnToAI()` back the inbox's TAKE OVER / RETURN TO AI
  controls (§15); `transferToPharmacist()` is the plan doc's mandatory medication-safety
  handoff (§7) — manual for now, since the AI that would trigger it automatically doesn't
  exist until Phase 5.
- **`src/app/api/whatsapp/webhook/route.ts`** — the one route Meta calls, with NO session
  cookie (see `src/proxy.ts`'s new exception for this exact path): `GET` answers the
  handshake, `POST` verifies the signature (403 if it fails), then processes every inbound
  message in its own try/catch so one bad entry never fails the whole delivery — Meta
  disables a webhook that doesn't answer 200 quickly and reliably. Delivery/read status
  receipts (`value.statuses`) are logged but not yet persisted (no column for them yet);
  an inbound type we don't have a dedicated `MessageType` for (location, button replies,
  reactions, …) is stored as `SYSTEM` with a readable placeholder rather than dropped.
- **API routes** for the Inbox CRM (§15), all gated behind `WHATSAPP_SEND`/`WHATSAPP_TAKEOVER`
  (the permissions Phase 1 already seeded for `CUSTOMER_SERVICE` — no new permission keys
  needed this phase) and branch-scoped when a conversation has an `assignedBranchId`:
  - `GET /api/whatsapp/conversations` (inbox list, newest activity first, one-message
    preview), `GET /api/whatsapp/conversations/[id]` (full thread)
  - `POST /api/whatsapp/send` (a human's reply — does not require having taken over first)
  - `POST /api/whatsapp/conversations/[id]/takeover`, `/return-to-ai`,
    `/transfer-to-pharmacist`, `/close`
- A conversation's `assignedBranchId` is set by matching the WhatsApp number Meta delivered
  the message TO (`value.metadata.display_phone_number`) against `Branch.whatsappNumber` —
  real but simple; smarter routing (by what the customer is asking about) is Phase 5's job.
- **No AI auto-reply yet** — that's the whole point of Phase 5. Today, an inbound message
  just sits in an OPEN, `assignedAgent: AI` conversation until a human replies via
  `POST /api/whatsapp/send` (optionally after `takeover`). Phase 5 is what makes the "AI"
  label actually do something.

### Setting it up to test (no business-verified number needed yet)

1. Create an app at [developers.facebook.com](https://developers.facebook.com) → add the
   "WhatsApp" product → **API Setup** tab gives you a test phone number, a temporary
   access token, and a field to add your own phone as a verified recipient (needed to
   receive test messages).
2. Fill `.env`: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (both from that page),
   `WHATSAPP_APP_SECRET` (App Dashboard → Settings → Basic), and make up your own
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
3. Your `/api/whatsapp/webhook` needs a public HTTPS URL for Meta to reach — for local dev,
   tunnel it (e.g. `ngrok http 3000`) and use the `https://....ngrok.../api/whatsapp/webhook`
   URL below.
4. In the app's **Webhooks** tab: Callback URL = that tunnel URL, Verify Token = the same
   string you put in `.env`, subscribe to the `messages` field. Meta immediately calls your
   `GET` handler — it should return the challenge and show "Verified" in the dashboard.
5. From the API Setup page, send yourself a test message, then WhatsApp your test number
   back from your phone — that inbound message should land in Postgres:
   ```bash
   curl -i http://localhost:3000/api/whatsapp/conversations -b cookies.txt
   curl -i -X POST http://localhost:3000/api/whatsapp/send -b cookies.txt \
     -H "Content-Type: application/json" \
     -d '{"conversationId":"<conversationId>","text":"شكراً لتواصلك معنا!"}'
   ```
   (The reply only succeeds if you're still inside the 24-hour window — i.e. you messaged
   the test number recently — otherwise Meta rejects it and asks for a template message.)

## What's prepared for Phase 5 (while waiting on an Anthropic API key)

Phase 5 (AI Customer Service) needs `ANTHROPIC_API_KEY` — a real LLM call costs real money
and the plan doc explicitly lists this as a decision only you can make ("مفتاح Anthropic API
(أو مزوّد آخر) مرتبط ببطاقة"). Rather than wait idle, everything that does NOT require
actually calling a live model is built and type-checked below. **None of it has run against
a real key in this sandbox — there isn't one to test with.** Treat this as reviewed
scaffolding, not a tested feature, and exercise it once end-to-end before trusting it with
real customers.

- **`src/lib/anthropic.ts`** — a thin raw-`fetch` client over the real Anthropic Messages
  API (no SDK dependency, same style as `src/lib/whatsapp.ts`'s Graph API client).
  `AnthropicConfigError` throws at call time (not import time) when `ANTHROPIC_API_KEY` is
  unset, so every other phase keeps working with Phase 5 totally unconfigured.
- **`src/lib/aiTools.ts`** — the 9 Tool Calling functions named verbatim in the plan doc's
  "قواعد الذكاء الاصطناعي" list: `search_inventory`, `reserve_product`, `create_order`,
  `assign_pharmacy`, `create_delivery`, `search_customer`, `send_whatsapp_message`,
  `search_documents`, `create_carelink_job`. Every one calls `hasPermission()` against a
  dedicated AI identity before doing anything else (see below) — per the plan doc's own
  rule, "كل Tool يتحقق قبل التنفيذ من: authentication، permissions، input validation،
  business rules." A few needed an explicit interpretation call, since the plan doc names
  the tools but not every implementation detail — flagging each rather than guessing
  silently:
  - `reserve_product` is a **dry-run availability check, not a database write** — the
    schema's `Reservation` model is keyed on `orderItemId`, so there's no "hold without an
    order" to create. The real reservation happens atomically inside `create_order`
    (`orders.ts`'s `createOrder()`, already built in Phase 3), which re-checks the same
    stock math at commit time.
  - `assign_pharmacy` picks a branch by **real stock, not geography** — `Branch` has no
    stored lat/lng (only `Customer` does), so inventing a "nearest branch" rule the schema
    can't back would be exactly the kind of unfounded assumption this project avoids.
  - `create_delivery` **auto-picks the first AVAILABLE driver** when none is given (unlike
    the human dispatcher's `POST /api/deliveries` from Phase 6, which always requires an
    explicit driver) — this backs the plan doc's automatic "READY FOR DELIVERY → إنشاء
    Delivery Task تلقائياً" step.
  - `search_documents` runs a real (currently empty) query over the `documents` table —
    filename/tag matching only, no OCR/semantic search (that's Phase 8).
  - `create_carelink_job` is **permission-blocked by design**: `CARELINK_ADMIN` isn't in the
    AI's permission set, so this always rejects before even reaching its body. Even a human
    caller who does hold that permission still hits a `BusinessRuleError` — CareLink
    integration itself is still blocked (Phase 7, waiting on you to clarify the platform),
    so there's no Adapter to actually run a job through yet.
- **A dedicated, non-login AI identity** (`src/lib/aiSystem.ts`, seeded unconditionally in
  `prisma/seed.ts`) — every Tool call's permission check and audit-log row uses this
  account's `userId`/`roleId`, never a bypass. `ROLES.AI_AGENT`'s permission set
  (`INVENTORY_READ`, `ORDERS_READ`/`WRITE`, `CUSTOMERS_READ`/`WRITE`, `WHATSAPP_SEND`,
  `DELIVERY_MANAGE`, `DOCUMENTS_READ`) deliberately excludes everything on the plan doc's
  Human Approval list (`ORDERS_CANCEL`, `PRICING_WRITE`, `INVENTORY_WRITE`,
  `DOCUMENTS_WRITE`/`DELETE`, `CARELINK_READ`/`ADMIN`, `USERS_MANAGE`) — the AI structurally
  cannot cancel a confirmed order, change a price, hand-edit stock, delete a file, or touch
  CareLink, independent of what the model decides to do. The account's `active: false` means
  it can never authenticate through `POST /api/auth/login` either.
- **`src/lib/aiOrchestrator.ts`** — `runAiTurn(conversationId)`: builds the message history
  from `WhatsappMessage` rows, calls the real Messages API with a system prompt that
  hardcodes the plan doc's fixed AI rules (no diagnosis/prescription/dosage changes → tell
  the customer you're transferring to a pharmacist; every final reply goes through the
  `send_whatsapp_message` tool, never raw model text), and loops executing `tool_use` blocks
  through the registry above, capped at 6 iterations as a defensive ceiling against a
  confused loop.
- **Wired into the webhook** (`src/app/api/whatsapp/webhook/route.ts`): after persisting an
  inbound message, if the conversation's `assignedAgent` is `AI`, `runAiTurn()` runs
  best-effort in its own try/catch — an `AnthropicConfigError` (expected right now, with no
  key set) logs as a warning; nothing it does can break message persistence or Meta's
  required fast-200 ack. It runs synchronously inside the request for now — no background
  queue yet, the same documented gap `releaseExpiredReservations()` already has (Phase 10's
  job).

**What this does NOT do yet:** nothing here has actually talked to a model. Once
`ANTHROPIC_API_KEY` is in `.env`, the very next inbound WhatsApp message to an
`assignedAgent: AI` conversation will trigger a real call — test that first conversation
closely (check server logs for `[aiOrchestrator]` and `[whatsapp webhook]` lines) before
relying on it for real customers.

## What's in Phase 6

Delivery assignment and driver lifecycle — the piece Phase 3 left as a status-only
`/advance` call with no real `Delivery` record behind it.

- **No account-creation endpoint existed anywhere** before this phase — only the Phase 1
  seed script's bootstrap SUPER_ADMIN. **`src/lib/users.ts`**'s `createUser()` is a
  deliberately minimal addition to make onboarding anyone else possible at all: gated by
  `USERS_MANAGE` (SUPER_ADMIN only — `prisma/seed.ts` excludes even ADMIN from it), it is
  **not** a general admin-users UI — that's still Phase 11 territory, same as the rest of
  the admin dashboard. `POST /api/drivers` is its only caller today.
- **`src/lib/drivers.ts`** — `createDriverAccount()` creates the `User` (role
  `DELIVERY_DRIVER`) and its linked `Driver` row in one transaction, since a driver has no
  identity without a login. `setAvailability()` is self-service only (a dispatcher can't
  toggle someone else's AVAILABLE/BUSY/OFFLINE flag — only the driver knows if they're
  actually free); `listDrivers()` backs the dispatcher's roster view.
- **`src/lib/delivery.ts`** — the core of this phase:
  - `createDelivery()` requires the order to already be `READY_FOR_DELIVERY` (orders.ts's
    own gate) and computes `amountToCollect` from the order's line items with `Prisma.Decimal`
    arithmetic (Phase 3's orders don't carry a stored total). `Delivery.orderId` is `@unique`
    in the schema, so this can only ever succeed once per order.
  - `reassignDriver()` is **also how a `FAILED` delivery is retried** — there's no separate
    retry function. Because `orderId` is `@unique`, a failed delivery can never get a second
    row, so reassigning a new driver onto a `FAILED` delivery resets it back to `ASSIGNED`
    in place instead. Allowed from `ASSIGNED`, `ACCEPTED`, or `FAILED` — not after
    `PICKED_UP`, where the original driver already physically holds the order.
  - `advanceDeliveryStatus()` drives the driver-facing lifecycle (`ACCEPTED` → `PICKED_UP`
    → `ON_THE_WAY` → `DELIVERED`, or `FAILED` from anywhere before `DELIVERED`). Ownership
    check: a `DELIVERY_DRIVER` caller may only advance their own delivery
    (`driver.userId === caller.userId`); any other `DELIVERY_MANAGE` holder (dispatcher,
    `PHARMACY_MANAGER`, admin) can act on any delivery — the dispatcher-override case.
  - Reaching `ON_THE_WAY` / `DELIVERED` also calls `orders.ts`'s existing
    `advanceOrderStatus()` (→ `OUT_FOR_DELIVERY` / `DELIVERED`) and the new
    `notifyCustomer()` — see "deliberately NOT done yet" below for why those run as two
    sequential steps rather than one shared transaction.
- **`src/lib/conversations.ts`** gained `notifyCustomer()` — gets-or-creates the customer's
  open conversation and sends through the same Graph API path as a human reply, but wraps
  it so a Meta send failure (most commonly: the 24h window is closed and no approved
  template exists) is caught and logged, never thrown — a delivery/order update must never
  roll back because a WhatsApp notification couldn't go out.
- **API routes**, all gated behind `DELIVERY_MANAGE` except account creation itself
  (`USERS_MANAGE`):
  - `POST /api/drivers` (create a driver account), `GET /api/drivers` (roster, optional
    `?availability=`)
  - `PATCH /api/drivers/me/availability` (self-service only)
  - `POST /api/deliveries` (assign a driver to a `READY_FOR_DELIVERY` order),
    `GET /api/deliveries` (branch-scoped list, optional `?status=`/`?driverId=`)
  - `GET /api/deliveries/mine` (a driver's own active queue)
  - `GET /api/deliveries/[id]`
  - `POST /api/deliveries/[id]/reassign` (also the retry path for `FAILED`)
  - `POST /api/deliveries/[id]/advance` (body `{status, reason?}`)
- `prisma/seed.ts`: `PHARMACY_MANAGER` now also holds `DELIVERY_MANAGE` (the natural local
  dispatcher), alongside `DELIVERY_DRIVER`, which already held it from Phase 1's seed.

## What's in Phase 9

Reports and Analytics — read-only views over data every earlier phase already writes;
nothing here changes the write paths.

- **`requirePermissions()`** added to `src/lib/apiGuard.ts` alongside the existing
  `requirePermission()` — checks a *list* of permissions with AND logic instead of one.
  Needed because `ACCOUNTING` already holds `REPORTS_READ` (seeded Phase 1) but the plan
  doc's role table restricts them to "التقارير المالية فقط، بلا وصول للمخزون أو الطلبات
  التشغيلية" (financial reports only, no inventory/operational-order access) — a
  single-permission check can't express "REPORTS_READ is not enough here, you also need
  INVENTORY_READ/ORDERS_READ/DELIVERY_MANAGE." `requirePermission()` itself is unchanged
  and still what every single-permission route uses.
- **`src/lib/reports.ts`** — four report builders plus the audit-log reader:
  - `getSalesReport()` — revenue, order count, average order value, revenue-by-day, and the
    top 10 products by revenue, over orders whose status has actually committed stock
    (`CONFIRMED` through `DELIVERED` — a `REVENUE_STATUSES` list that excludes
    `PENDING_CONFIRMATION`, which hasn't left the reservation stage, and `CANCELLED`, which
    never will). Gated by `REPORTS_READ` alone — the one report ACCOUNTING can reach without
    an extra permission.
  - `getInventoryValuationReport()` — current stock value (`qtyOnHand * price`) per branch,
    plus the same out-of-stock/low-stock/near-expiry counts the Global Inventory screen
    shows (reuses `getInventoryAlerts()` from Phase 2 rather than re-deriving the
    thresholds). Gated by `REPORTS_READ` **+** `INVENTORY_READ`.
  - `getOrdersOperationsReport()` — order counts by status, cancellation rate, and an
    **approximate** average fulfillment time for orders that reached `DELIVERED`. Gated by
    `REPORTS_READ` **+** `ORDERS_READ`.
  - `getDeliveryPerformanceReport()` — delivery counts by status, failure rate, an
    **approximate** average delivery time, and a per-driver breakdown (delivered/failed
    counts + that driver's own average time). Gated by `REPORTS_READ` **+**
    `DELIVERY_MANAGE`.
  - `listAuditLog()` — the **first route ever exposing `audit_logs`**, a table every phase
    since Phase 1 has written to (`logAudit()` in `src/lib/audit.ts`) but nothing has read
    back until now. Deliberately its own permission, `AUDIT_READ`, **not** `REPORTS_READ` —
    matching the plan doc's own seed grant (`SUPER_ADMIN`, `ADMIN`, `ACCOUNTING` all hold
    `AUDIT_READ` since Phase 1) and **not branch-scoped**, since `AuditLog` has no
    `branchId` column — it logs an action against an entity, not a branch's data.
  - **"Approximate" is flagged, not hidden:** neither `Order` nor `Delivery` has a
    dedicated "delivered at" / "picked up at" timestamp column (see `schema.prisma`) — only
    one shared `updatedAt` per row. Both time-based metrics above use
    `updatedAt - createdAt` for rows that reached their terminal success state, which in
    practice *is* the right timestamp (nothing else writes to a `DELIVERED` order/delivery
    again) but is flagged `...IsApproximate: true` in the API response rather than presented
    as an exact, dedicated measurement — consistent with this project's rule against
    quietly fabricating precision the schema doesn't actually have.
- **API routes**, each permission-checked and branch-scoped the same way as every earlier
  phase's list routes (`canAccessBranch()` restricts a branch-scoped caller to their own
  branch; `SUPER_ADMIN`/`ADMIN`/`ACCOUNTING` can pass `?branchId=` for any branch or omit it
  for the whole network):
  - `GET /api/reports/sales` (optional `?branchId=&from=&to=`, ISO date strings)
  - `GET /api/reports/inventory-valuation` (optional `?branchId=`)
  - `GET /api/reports/orders` (optional `?branchId=&from=&to=`)
  - `GET /api/reports/delivery` (optional `?branchId=&from=&to=`)
  - `GET /api/audit` (optional `?userId=&action=&entity=&from=&to=&limit=`, network-wide,
    not branch-scoped — see above)

## What's prepared for Phase 10 (security hardening — the part that needs no hosting decision)

The plan doc's Phase 10 is "اختبار الأمان + النشر الفعلي" (security testing + real
deployment) and its own execution-plan table marks it "نعم — قرار الاستضافة" (needs a
hosting decision). The *testing/hardening* half doesn't actually depend on where this ends
up hosted, so that's what's built here; the *deployment* half (Secrets Manager, HTTPS
termination, daily DB backups, a distributed rate limiter) still needs you to pick a host
first — see "What's deliberately NOT done yet" below.

- **2FA (TOTP) for ADMIN/SUPER_ADMIN** — the plan doc's §16 requirement, previously a
  `// TODO` in `src/app/api/auth/login/route.ts`:
  - **`src/lib/twoFactor.ts`** (new) — a thin wrapper over `otpauth` (added as a
    dependency): `generatePendingTwoFactorSecret()` makes a fresh random secret +
    `otpauth://` enrollment URI (RFC 6238 defaults: 30s step, 6 digits, SHA-1 — what every
    common authenticator app assumes); `verifyTwoFactorToken()` checks a 6-digit code with
    a ±1 step window for clock drift.
  - **Three new self-service routes**, ADMIN/SUPER_ADMIN only: `POST /api/auth/2fa/setup`
    (generates + stores a *pending* secret, returns the enrollment URI/secret — there's no
    dashboard UI yet to render it as a QR code, so the raw value comes back as-is),
    `POST /api/auth/2fa/enable` (body `{"token"}` — proves the admin can actually produce a
    valid code before `twoFactorEnabled` ever flips to `true`), `POST /api/auth/2fa/disable`
    (body `{"token"}` — self-service only, requires a currently-valid code; see
    "deliberately NOT done yet" for why there's no admin-forced reset).
  - **`src/app/api/auth/login/route.ts`** now actually enforces it: if
    `user.twoFactorEnabled`, the login body must include a valid `totpToken` or the request
    is rejected (`requiresTwoFactor: true` in the response body when it's simply missing,
    vs. a plain wrong-code error when it's present but invalid). **Enforcement is per-admin,
    not per-role** — an ADMIN/SUPER_ADMIN who hasn't called `/api/auth/2fa/setup` +
    `/enable` yet can still log in with just a password, exactly as before. Making it
    mandatory at the role level needs an enrollment UI to walk them through it first (so
    nobody gets locked out) — that's Phase 11 dashboard territory, not something to force
    from an API-only backend.
- **Login rate limiting** — **`src/lib/rateLimit.ts`** (new): a plain in-memory
  fixed-window limiter, applied in `POST /api/auth/login` keyed by both the identifier and
  the requester's IP (10 attempts / 10 minutes each — whichever is tighter wins), returning
  `429` once exceeded. Deliberately NOT Redis-backed — it's per-server-instance only (see
  the file's own comment), which is exactly why it needs no hosting decision: it's real
  protection today, with the known limitation that running more than one instance behind a
  load balancer multiplies the effective limit by however many instances there are. A real
  distributed limiter belongs with the Background Jobs/Queue layer's Redis, which is Phase
  10's hosting decision, not before it.
- **Postgres CHECK constraints** — `prisma/manual-sql/qty_reserved_check.sql` (new): since
  Prisma's schema DSL can't express a multi-column CHECK directly, and this sandbox could
  never run `prisma migrate dev` at all (see "Known limitation" below, so there's no
  `prisma/migrations/` folder yet to append to), this ships as a standalone SQL script to
  run once against your real database after your first `prisma migrate dev --name init`:
  `qtyReserved <= qtyOnHand`, plus `qtyOnHand >= 0` and `qtyReserved >= 0` as a backstop
  against a bypass of the application layer (which already enforces all three in code —
  `adjustInventory()` in `src/lib/inventory.ts`, every reservation path in
  `src/lib/orders.ts`).
- **Audit-log coverage gap, found and fixed** — while reviewing the plan doc's §16
  traceability requirement against the actual code, `audit_logs` turned out to only ever be
  written from `orders.ts` and `delivery.ts`; `adjustInventory()` and `upsertInventoryMeta()`
  (`src/lib/inventory.ts`), and `disableBranch()`/`enableBranch()`/`deleteBranch()`
  (`src/lib/branches.ts`), and `deleteProduct()` (`src/lib/products.ts`) never wrote one —
  despite price changes and inventory adjustments being exactly the kind of §25
  human-approval-adjacent action the audit trail exists for. All five now take a `userId`
  and log to `audit_logs` inside the same transaction as the change itself, same pattern as
  `orders.ts` already used. The calling routes (`/api/inventory`, `/api/inventory/adjust`,
  `/api/branches/[id]`, `/api/products/[id]`) now pass `session.userId` through.
- **§16 checklist** — the plan doc's security section item by item, what's actually true
  today:
  - RBAC at the API level — done since Phase 1 (`hasPermission()`/`requirePermission()`).
  - 2FA for ADMIN/SUPER_ADMIN — done (per-admin opt-in, see above).
  - Secrets (CARELINK_USERNAME, etc.) in a Secrets Manager, never in code — true in code
    today (everything sensitive comes from `process.env`, nothing is hardcoded), but *where*
    those env vars live in production (a real Secrets Manager vs. plain env vars on a host)
    is a hosting decision, not a code change.
  - HTTPS + secure sessions everywhere — the session cookie already sets `secure: true`
    whenever `NODE_ENV=production` (`src/app/api/auth/login/route.ts`); actually terminating
    HTTPS is the hosting provider's job.
  - API authentication + rate limiting — authentication done since Phase 1; rate limiting
    now partially done (login brute-force, see above) — broader per-route rate limiting is
    usually a reverse-proxy/edge concern (nginx, Cloudflare) configured at the hosting layer.
  - Webhook signature verification on every inbound WhatsApp request — done since Phase 4
    (`verifyWebhookSignature()`, checked before anything else runs in the webhook route).
  - Daily DB backups — purely an infrastructure/hosting setting (e.g. your Postgres
    provider's automated backup schedule); nothing in application code to add.
  - No passwords/API keys in the frontend — true by construction: this project is API-only
    so far (no frontend exists yet to leak anything from).

## What's prepared for Phase 8 (Document AI — while waiting on a storage decision)

The plan doc names this module "رفع، تصنيف، OCR عند الحاجة" (upload, classification, OCR
when needed) and its own decisions table lists file storage as a real open decision ("S3 /
Cloudflare R2 / Google Cloud Storage — أيهم متاح أو مفضّل لديك؟"). Per this project's hard
rule — never invent a fake API for an integration that isn't decided — everything that
does NOT require knowing which provider you'll pick is built below; the one thing that
can't run yet is moving actual bytes anywhere, since there's nowhere real to send them.

- **`src/lib/storage.ts`** (new) — the Adapter Interface itself: `StorageAdapter`
  (`upload`/`download`/`getDownloadUrl`/`delete`) and `StorageConfigError`.
  `getStorageAdapter()` throws that error today, on purpose — exactly like
  `requireAnthropicConfig()` in `src/lib/anthropic.ts` does for the still-missing
  `ANTHROPIC_API_KEY`. There is deliberately no "DefaultStorageAdapter" that quietly writes
  to local disk or an in-memory map standing in for a real provider — that would be exactly
  the invented-API problem this rule exists to prevent. Once you pick S3, R2, or GCS,
  implementing one class that satisfies `StorageAdapter` and returning it here is the
  **entire** change — `documents.ts`, `documentAi.ts`, and every Phase 8 route already talk
  only to this interface, never to a vendor SDK directly.
- **`src/lib/documents.ts`** (new) — storage-agnostic CRUD/search, all built and
  type-checked against the interface above: `uploadDocument()` (calls the adapter, then
  writes the `Document` row — in that order, so a storage failure never leaves an orphaned
  metadata row pointing at nothing), `searchDocuments()` (filename/tag/ownerType matching —
  the same query `src/lib/aiTools.ts`'s `search_documents` Tool now delegates to instead of
  keeping its own copy), `getDocument()`, `getDocumentDownloadUrl()` (a time-limited signed
  link, never the raw storage key — that key is meaningless outside the adapter that wrote
  it), and `deleteDocument()`. Upload/delete both write an `audit_logs` row, same pattern
  Phase 10's hardening pass applied everywhere else.
- **`src/lib/documentAi.ts`** (new) — the classification/OCR half. **An interpretation
  call, flagged exactly like `reserve_product`/`assign_pharmacy`/`create_delivery` were
  flagged in the Phase 5 prep writeup:** the plan doc names Document AI's job but not an
  OCR vendor, and unlike file storage this was never listed as its own open decision — so
  rather than inventing a brand-new OCR provider this project has no account/budget for,
  `classifyAndExtractText()` reuses the Anthropic integration Phase 5 already identified as
  the project's one LLM (`src/lib/anthropic.ts`'s `callMessagesApi()`), sending the document
  as an image/PDF content block and asking for strict JSON back
  (`{category, extractedText, confidence}` against a fixed 6-value category vocabulary —
  also an interpretation call, since the plan doc doesn't name specific categories).
  `runDocumentAi(documentId)` is the on-demand orchestration — fetch the bytes through the
  storage adapter, classify, persist the result onto the `Document` row's `tags`/`metadata`
  — triggered explicitly via a route, never automatically on upload (that's the "عند
  الحاجة" / "when needed" in the plan doc's own wording). **Untested, same as every
  `anthropic.ts` caller**: no `ANTHROPIC_API_KEY` exists in this sandbox.
- **API routes**, all permission-checked: `GET/POST /api/documents` (POST takes a base64
  body — there's no frontend yet to post a real multipart `<form>` from),
  `GET/DELETE /api/documents/[id]`, `GET /api/documents/[id]/download` (returns a
  time-limited URL, never proxies the bytes through Next.js itself),
  `POST /api/documents/[id]/analyze` (triggers `runDocumentAi()`). Every route that touches
  storage returns a clean `501` with `StorageConfigError`'s message today — not a 500 crash
  — until a provider is wired in; `/analyze` does the same for `AnthropicConfigError`.
- **`.env.example`** — added a commented storage-provider section with the three
  candidates' env var shapes (S3/R2/GCS), so picking one is "uncomment this block, fill in
  real values, implement the matching adapter class" rather than guessing at variable
  names later.
- **Permission note, not a decision made for you:** today only `SUPER_ADMIN`/`ADMIN` hold
  `DOCUMENTS_WRITE`/`DOCUMENTS_DELETE` (via the "all permissions" seed grant from Phase 1) —
  nobody else, not even `PHARMACY_MANAGER` or `CUSTOMER_SERVICE`, can upload or delete a
  document yet. Whether those roles should manage documents day-to-day is a product
  decision for you, not something this prep pass changed on its own; `DOCUMENTS_READ` is
  similarly narrow (`SUPER_ADMIN`/`ADMIN`/`AI_AGENT` only — see `prisma/seed.ts`).
- **Branch scoping note:** `Document` has no `branchId` column (same gap `AuditLog` has —
  see Phase 9's README section), so none of these routes are branch-scoped today; a
  document is scoped only by its `ownerType`/`ownerId`. Adding real branch scoping would
  mean either a schema change or deriving it through a join (e.g. `ownerType: "order"` →
  that order's `branchId`) — not done here, flagged rather than guessed at.

## Real branch data + the Bekaa/Baalbek-Hermel routing rule (this session, from your phone-number list)

You sent a `.docx` ("فيما يلي لائحة بالصيدليات") with 7 rows: 6 real pharmacy
branches' phone numbers + addresses, plus a 7th row for "Carelink ديلفري". This section is
about what was built from it — real business data and one new routing rule, not another
decision-free prep pass like Phases 5/8/10 above.

- **Geographic correction worth reading before anything else:** you said the rule is
  "عميل من البقاع → يبحث فقط عند الجواد كير والعاصي". Your own document's addresses for
  those two branches are **بعلبك** (الجواد كير) and **الهرمل** (العاصي) — both in Baalbek-
  Hermel Governorate, which has been administratively separate from Bekaa Governorate since
  2017. You're clearly using "البقاع" the way most Lebanese actually talk — the old,
  undivided Bekaa — not the narrower post-2017 line, and that's backed directly by these two
  real addresses, not assumed. `src/lib/region.ts` documents this explicitly and its
  place-name list covers both governorates (Zahle/Chtaura/West Bekaa/Rachaya **and**
  Baalbek/Hermel/Ras El Ain). If you actually meant the narrower Bekaa Governorate only, say
  so and this is a one-file fix.
- **`src/lib/region.ts`** (new) — `isLikelyBekaaAddress(address)`: a plain, inspectable
  substring match against real Bekaa/Baalbek-Hermel place names (not a geo-distance
  calculation — `Branch` has no lat/lng, only `Customer` does, same reasoning
  `assign_pharmacy`'s own existing comment already gives for avoiding that), and not an
  AI/LLM guess. It runs against `Customer.address` — the one free-text field that exists for
  this today. This is a heuristic, flagged as such; extend the place-name list as real
  addresses come in rather than treating it as finished.
- **`prisma/schema.prisma`** — added `Branch.isBekaaExclusive` (`Boolean @default(false)`),
  set `true` only on الجواد كير والعاصي (via the seed script below). A general flag, not a
  name check, so a future branch covering the same area is just one more `true`.
- **`src/lib/aiTools.ts` / `src/lib/aiOrchestrator.ts`** — the actual routing logic, and
  deliberately enforced server-side, not left to the model: `aiOrchestrator.ts` now passes
  `{ conversationId }` as a second argument to every tool handler (new `AiToolContext` type on
  `AiToolSpec`); `search_inventory` and `assign_pharmacy` use it to load the *real*
  conversation → customer → address and run it through `isLikelyBekaaAddress()` themselves
  (`getBekaaBranchRestriction()`), rather than trusting a `customerPhone`-shaped field the
  model could mistype or omit. When it matches, both tools narrow their branch candidates to
  the `isBekaaExclusive` set — overriding any `branchId`/`preferredBranchId` the model passed
  — and the result carries `restrictedToBekaaBranches: true` so the AI can see that this was
  the system's own decision and relay it naturally (the system prompt now explains this
  field).
- **The special delivery arrangement — now wired in, with your real numbers** ("ديلفري
  الجواد كير" `81501394`, "ديلفري العاصي" `76324551`): `Branch.specialDeliveryContactWhatsapp`
  (new column, `null` on every other branch) holds each number in E.164. This is deliberately
  **not** modeled as a `Driver`/`Delivery` row (Phase 6) — same reasoning as CareLink's own
  number: it reads as a phone/WhatsApp contact a human calls, not an in-app driver resource
  with tracked availability. So `create_delivery`'s handler in `aiTools.ts` now checks the
  order's branch first: if no `driverId` was given AND the branch has this number set, it
  throws a clear, informative error naming the real contact instead of auto-picking a random
  AVAILABLE driver from the network-wide pool (which likely doesn't even reach
  Baalbek/Hermel) — the system prompt explains this so the AI relays it naturally ("سيُنسَّق
  التوصيل عبر خط [الفرع]: [الرقم]") rather than treating it as a failure. An explicit
  `driverId` is still honored untouched, in case a human dispatcher deliberately wants to use
  an in-app driver for one of these two anyway — nothing here forbids that, it just stops the
  *automatic* fallback from guessing wrong. `assign_pharmacy`'s result also now carries
  `specialDeliveryContactWhatsapp` directly, so the AI already has the number while still
  planning the order, before `create_delivery` is even called.
- **`prisma/real-data/seedRealBranches.ts`** (new) + `npm run seed:real-branches` — the 6
  real branches, upserted by `whatsappNumber`. Kept **out of** `prisma/seed.ts` on purpose
  (that file only ever creates role/permission scaffolding + one bootstrap SUPER_ADMIN — see
  its own comments — never speculative business data); run this once by hand against your
  real database. `whatsappNumber` is the **mobile number only** from each row, in E.164
  (`+961...`) — per your instruction ("لا تاخذ 01 او 08، فقط أرقام الخليوي"), generalized to
  "any landline prefix", not literally only those two: صيدلية طالب's landline is `01...` and
  صيدلية يحيى's is `05...`, both excluded the same way. The landline (where a row had one) is
  kept in `phone` for display only — the AI agent is never meant to message it.
- **"Carelink ديلفري" (79003663, عنوانه "كافة المناطق") — NOT inserted as a `Branch` row.**
  Per your confirmed answer this session, it's most likely a plain phone/WhatsApp delivery
  contact, not a pharmacy and not a software platform — "كافة المناطق" (serves every area)
  reads as a logistics contact, not a branch location. Recorded as
  `CARELINK_CONTACT_WHATSAPP` in `.env.example` for reference; `create_carelink_job` in
  `aiTools.ts` still throws until Phase 7 is actually built (unchanged — you haven't asked to
  resume Phase 7 itself yet, only confirmed what CareLink most likely is).
- **Beirut's delivery company — now wired in too** (الرسول، يحيى، فارماكير، طالب): "شركة
  المختار", `71030940` → `+96171030940`. Confirms the guessed shape from this section's
  earlier version was right — ONE shared `specialDeliveryContactWhatsapp` value across all 4
  Beirut branches, unlike الجواد كير/العاصي's own separate per-branch numbers. A second
  schema field, `Branch.specialDeliveryContactLabel` (`"شركة المختار"` for these four, `null`
  for الجواد كير/العاصي since no company/person name was given for those), lets
  `create_delivery`'s error and `assign_pharmacy`'s result name the company, not just the raw
  number — e.g. "شركة المختار له خط توصيل خاص (+96171030940)" instead of a bare phone number
  with no context. Mechanically identical to the Bekaa/Baalbek-Hermel wiring above: no
  in-app `Driver`/`Delivery` row, `create_delivery` refuses the automatic driver-pool
  fallback for these branches and names the real contact instead, an explicit `driverId` is
  still honored if a human dispatcher deliberately wants one.
- **Resolved since the first version of this section:**
  1. الجواد كير والعاصي's own special delivery numbers arrived (`81501394` / `76324551`) and
     are wired in — see above.
  2. "لبيوت" was a typo for "بيروت" (Beirut) — resolved, see the Beirut bullet above.
- **Confirmed this session: there are no in-house drivers today — every delivery goes
  through an external line** (CareLink, شركة المختار, or الجواد كير/العاصي's own numbers).
  That matches exactly what the 6 real branches now do (every one of them has a
  `specialDeliveryContactWhatsapp`, so `create_delivery` always takes the "name the real
  contact" path today, never the auto-pick-a-driver one). Phase 6's `Driver`/`Delivery`
  pool and its routes (`/api/drivers`, `/api/deliveries`) are **not removed** — they're not
  wrong, just unused for now — kept as-is for whenever this pharmacy network does bring on
  its own drivers, since nothing was asked to change there and ripping out working code on
  a guess would be the same mistake as inventing one.
- **Still open, not guessed at:**
  1. `isLikelyBekaaAddress()` only ever sees `Customer.address`, which today is only ever set
     if a human CS rep or the AI itself asks the customer and writes it down — there's no
     form or WhatsApp flow yet that *reliably* collects it before `assign_pharmacy` runs. If a
     Bekaa/Baalbek-Hermel customer's address is still blank at that point, the rule simply
     won't fire (silently falls back to "no restriction", not an error) — worth deciding
     whether the AI's conversation flow should ask for the customer's area explicitly before
     searching, rather than only when one happens to already be on file.

## What's in Phase 7 (CareLink — now actually built, not just prep)

Three successive pictures of CareLink, each superseding the last, until this session's final
one turned out to be buildable for real:
1. `CarelinkJob.type`'s original examples (`classify_files`, `find_duplicates`,
   `create_folder`) — a pre-real-data guess that CareLink was a file-management platform.
   Disproven.
2. "Just a phone/WhatsApp delivery contact, same category as شركة المختار" — this session's
   earlier guess from the branch-list data. Superseded.
3. **Your full, detailed description, verbatim:** "استقبال carelink للطلبات تتم من خلال اتصال
   الزبون على الرقم الخاص لـ carelink ووكيل الذكاء الاصطناعي يقوم بالجواب على الرسالة بحيث
   يمكنه الدخول الى مخزون الصيدليات ويبحث عن المنتج ومن ثم يرسل رسالة للصيدلية بحجز المنتج
   ولدى رد الصيدلية وتزويده بالسعر يعود وكيل الذكاء الاصطناعي ويعلم الزبون بالسعر وعند الموافقة
   يتصل الذكاء الاصطناعي برقم الديلفري ويعلمه بالعنوان واي صيدلية الطلب" — plus three follow-up
   confirmations: CareLink's number is its own **separate WhatsApp Business number** (not a
   phone-only line); the pharmacy's reply is a **WhatsApp message from the branch's own
   number**; and the final delivery notification is an **automatic WhatsApp/text message, not
   a real voice call**. Every step is WhatsApp-based — nothing here needed a voice/telephony
   integration this project doesn't have.

**The real flow, as built:**
1. A customer messages CareLink's own WhatsApp number. The webhook
   (`src/app/api/whatsapp/webhook/route.ts`) recognizes the receiving number as
   `CARELINK_CONTACT_WHATSAPP` and opens the conversation with `channel: CARELINK`
   (`ConversationChannel` enum, new on `WhatsappConversation`) instead of the normal `DIRECT`.
2. The AI (a CareLink-specific system-prompt addendum + a channel-filtered Tool list — see
   `src/lib/aiOrchestrator.ts`) searches inventory (`search_inventory`) and picks a branch
   (`assign_pharmacy`), exactly like a normal conversation.
3. **New tool `request_branch_reservation`** sends a real WhatsApp message to that branch's
   own number asking them to reserve the item and reply with a price, and opens a
   `CarelinkInquiry` row (new model) to track the ask — tagged with a short reference code
   (`CLK-XXXXXX`) so the branch's reply can be matched back exactly if they quote it.
4. The branch replies over WhatsApp. The webhook recognizes the SENDER as one of our own
   branch numbers (on the CareLink-receiving number) and routes it to
   `src/lib/carelink.ts`'s `handleCarelinkBranchReply()` — never treated as a customer message.
   It best-effort-parses a price from the free text (`parsePriceFromText()`), records it on the
   `CarelinkInquiry`, appends a `"[رد الفرع]"` note to the ORIGINAL CareLink conversation (so
   the full exchange stays visible in the normal inbox thread), and resumes the AI turn there.
   A reply whose price couldn't be parsed is marked `NEEDS_REVIEW` instead of `ANSWERED` — the
   AI is instructed to tell the customer it needs a bit more time, never to invent a number.
5. The AI relays the price to the customer (`send_whatsapp_message`) and, on explicit approval,
   calls `create_order` — which now automatically tags the order `source: CARELINK` from the
   conversation's own trusted `channel` (no model-supplied field for this, same trust posture
   as the Bekaa-routing rule).
6. **New tool `notify_carelink_delivery`** sends a WhatsApp message to CareLink's own number
   with the order number, branch, and delivery address — `create_delivery`/the in-app driver
   pool is never used for a CareLink order (already enforced before this round; see below).

**Flagged assumptions, not silent guesses — correctable in one line each:**
- The final delivery notification reuses `CARELINK_CONTACT_WHATSAPP` — the one real CareLink
  number this project has data for (originally labeled "Carelink ديلفري" in your document). If
  CareLink's delivery staff actually watch a *different* number than their customer-facing
  line, say so; it's a one-line change (a second env var), not a redesign.
- A branch reply that doesn't quote the reference code is matched to "the latest `PENDING`
  inquiry for that branch" — a real limitation if a branch somehow has two open CareLink
  inquiries at once. Not fixed speculatively since nobody asked for a stronger mechanism and
  it's a rare case given the current real branch count.
- `request_branch_reservation` does not place a stock hold while waiting for the branch's
  reply (the real `Reservation` hold only exists once `create_order` runs, after the customer
  approves) — a documented, not-yet-addressed overselling risk if a branch gets two
  overlapping CareLink inquiries for the same low-stock item. No soft-hold mechanism was added
  for this since nobody asked for one and it would be new, un-requested complexity.
- `CarelinkInquiry.quotedPrice` is informational — relayed to the customer, but
  `create_order`/`createOrder()` still prices every line from `Inventory.price`, same as any
  other order. A free-text WhatsApp number was never trusted as the literal amount charged.

**`CarelinkJob`/`create_carelink_job`** are unchanged (still always throw, still unused by any
real path) — the real flow needed a different shape entirely (`CarelinkInquiry` +
`Order.source`, a single pending question with one WhatsApp reply, not a queueable job), which
is exactly why `CarelinkJob` turned out not to fit. Left in place rather than removed
unilaterally — whether to deprecate it is still a decision for you, not resolved here.

**Still not configured (expected — this is infrastructure setup, not a code gap):**
`WHATSAPP_CARELINK_PHONE_NUMBER_ID` needs CareLink's number registered as an additional number
under the same Meta WhatsApp Business App (same mechanism each branch's own number already
uses) before any of this can actually send/receive for real. Until then,
`src/lib/conversations.ts`'s `sendReply()` refuses to answer a CareLink conversation rather
than silently replying from the wrong (pharmacy) number.

## Known limitation in THIS sandbox (not a code issue)

I built and type-checked everything here, but could not run `prisma generate` or
`prisma migrate dev` in this cloud sandbox: its network policy blocks
`binaries.prisma.sh`, the host Prisma downloads its query/schema engine binaries from (a
`403` from the egress proxy — a deliberate policy block, not a bug to route around). For
Phase 2 I re-confirmed this is the *exact* and *only* blocker (not just assumed it, like
Phase 1's writeup): `prisma generate --no-engine` with the checksum check disabled still
fails on the same `403` fetching `libquery_engine.so.node.gz` from `binaries.prisma.sh` —
so even client-only generation needs that one blocked download.

What this means concretely:
- `npm install` ✅, `npx next build` ✅ (Turbopack compiles every route and lib file
  cleanly) up through the point where the build runs TypeScript against routes that import
  real enums (`BranchStatus`, `ProductType`, `InventoryTxType`) and `Prisma.*` payload
  types from `@prisma/client` — those only exist after `prisma generate` runs for real, so
  pre-generate the package only exports `PrismaClient` typed as `any` and nothing else.
- **Beyond "reviewed by hand":** I wrote a temporary local type-shim (not part of this
  delivery) that supplies the exact shapes `prisma generate` would produce for this
  schema's enums and payload types, re-ran `tsc --noEmit` against the *entire* project with
  it in place, and got **zero errors** — then deleted the shim. Redone for Phase 3 too
  (`OrderStatus`, `PaymentMethod`, `ReservationStatus`, and a shape for
  `Prisma.TransactionClient` covering every model `src/lib/orders.ts` touches inside its
  `$transaction` calls), again zero errors after fixing what it caught — two spots where an
  implicit-`any` from an un-generated client was masking a real gap (an unannotated
  `.map()` callback and a `Record<OrderStatus, …>` index needing an explicit cast), now
  fixed in the shipped code itself, not just the shim. Redone again for Phase 4
  (`AssignedAgent`, `ConversationStatus`, `MessageDirection`, `MessageType`,
  `Prisma.PrismaClientKnownRequestError` for the idempotent-insert catch in
  `appendInboundMessage()`) — zero errors this time with no code changes needed. Redone
  again for Phase 6 (`DeliveryStatus`, `DriverAvailability`, and a real shape for
  `Prisma.Decimal` to check the `amountToCollect` arithmetic in `src/lib/delivery.ts`) —
  zero errors again, no code changes needed. Also re-ran `next build` with the shim in
  place: TypeScript itself finishes clean ("Finished TypeScript" with no errors reported);
  the build then fails one step later at "Collecting page data" on `new PrismaClient()`
  throwing `"@prisma/client did not initialize yet"` — that's the *runtime* engine binary
  being missing, the exact same sandbox blocker, one layer further in, not a type error.
  Redone once more for the Phase 5 preparatory work (`src/lib/anthropic.ts`,
  `src/lib/aiTools.ts`, `src/lib/aiOrchestrator.ts`, `src/lib/aiSystem.ts` — no new enums
  needed beyond what Phase 6 already added to the shim) — this pass caught one real bug:
  `create_delivery` in `aiTools.ts` had `let driverId = givenDriverId` (an optional string)
  reassigned from `available[0].id` inside an `if` block; since that assignment's source was
  itself `any` (pre-`prisma generate`), TypeScript narrowed the merged result back to
  `string | undefined` rather than `string`, and `tsc` caught it as "not assignable" at the
  `createDelivery(...)` call right below. Fixed by declaring `driverId: string` explicitly
  so both branches must produce a real string (see that function's own comment) — zero
  errors after the fix. Redone once more for Phase 9 (`src/lib/reports.ts`, the two new
  routes under `src/app/api/reports/*`, `src/app/api/audit/route.ts`, and
  `requirePermissions()` in `src/lib/apiGuard.ts` — no new shim shapes needed beyond what
  Phase 6 already added, since Phase 9 only reads `Order`/`Inventory`/`Delivery`/`AuditLog`
  through relations the shim already covers) — zero errors, no code changes needed.
  Redone once more for the Phase 10 hardening pass (`src/lib/twoFactor.ts`,
  `src/lib/rateLimit.ts`, the three new `/api/auth/2fa/*` routes, and the audit-log-coverage
  edits to `inventory.ts`/`branches.ts`/`products.ts` and their callers) — no new shim
  shapes needed (nothing here touches a Prisma type the shim didn't already cover) — zero
  errors, no code changes needed. Redone once more for the Phase 8 preparatory work
  (`src/lib/storage.ts`, `src/lib/documents.ts`, `src/lib/documentAi.ts`, the five new
  `/api/documents/*` routes, and the `aiTools.ts` dedup) — again no new shim shapes needed
  (the `Document` model has no enum/payload type anywhere in this codebase to shim; every
  `prisma.document.*` call already resolves through the pre-generate client's blanket
  `any`) — zero errors, no code changes needed. Redone once more for this session's real
  branch data + Bekaa/Baalbek-Hermel routing rule (`src/lib/region.ts`,
  `prisma/real-data/seedRealBranches.ts`, the `AiToolContext`/`getBekaaBranchRestriction()`
  changes to `src/lib/aiTools.ts`, and the context-passing change to
  `src/lib/aiOrchestrator.ts`) — again no new shim shapes needed (this work only adds a
  `Boolean` column and reads `prisma.whatsappConversation`/`prisma.branch`, both already
  covered) — zero errors, no code changes needed. Redone once more immediately after, for the
  special-delivery-contact follow-up (`Branch.specialDeliveryContactWhatsapp`, the
  `create_delivery` handler change in `aiTools.ts`, `assign_pharmacy`'s new
  `specialDeliveryContactWhatsapp` field, and the seed script update) — again no new shim
  shapes needed (another plain `String?` column, read through `prisma.order.findUnique`'s
  existing `any`-typed pre-generate shape) — zero errors, no code changes needed. Redone once
  more for Beirut's delivery company (`Branch.specialDeliveryContactLabel`, the matching
  `create_delivery`/`assign_pharmacy` changes, and the seed script's 4 Beirut rows) — same
  story, another plain `String?` column, zero errors, no code changes needed. Redone once
  more for the Phase 7 comment corrections + `src/lib/carelink.ts` (new file, one function,
  reads a single env var into a plain object — no new Prisma-related types at all) — zero
  errors, no code changes needed. Redone once more for the `OrderSource` addition (the new
  enum itself, `Order.source` in `prisma/schema.prisma`, the `CreateOrderInput`/`createOrder()`
  change in `src/lib/orders.ts`, and the `create_delivery` check in `src/lib/aiTools.ts`) — this
  pass needed one genuinely new shim shape (`OrderSource: { DIRECT; CARELINK }`, not covered by
  anything added for earlier phases) — zero errors after adding it. Redone once more, the
  biggest pass this session, for the real CareLink order-broker build (`ConversationChannel`
  on `WhatsappConversation`, the new `CarelinkInquiry` model/`CarelinkInquiryStatus` enum, the
  `fromPhoneNumberId`/`phoneDigits` additions to `src/lib/whatsapp.ts`, the channel-scoped
  conversation lookup + `careLinkPhoneNumberIdOrThrow()` in `src/lib/conversations.ts`, the new
  `handleCarelinkBranchReply()`/`parsePriceFromText()` in `src/lib/carelink.ts`, the webhook's
  branch-reply routing in `src/app/api/whatsapp/webhook/route.ts`, the two new Tools
  (`request_branch_reservation`, `notify_carelink_delivery`) plus `create_order`'s
  channel-aware `source` and `getConversationChannel()` in `src/lib/aiTools.ts`, and the
  channel-filtered Tool list + CareLink system-prompt addendum in `src/lib/aiOrchestrator.ts`)
  — needed two new shim shapes (`ConversationChannel`, `CarelinkInquiryStatus`) — zero errors
  after adding them. Also re-ran `next build` with the shim in place each time:
  TypeScript itself finishes clean again, same "did not initialize yet" Prisma-engine error
  one step later, same sandbox blocker. That confirms every Phase 1–6, Phase 9, and Phase 10
  file, the Phase 5 and Phase 8 preparatory work, this session's Bekaa-routing +
  special-delivery work (Baalbek-Hermel and Beirut both), the `OrderSource`/`create_delivery`
  CareLink-dispatch check, and the real CareLink order-broker build above all type-check
  correctly against the real schema; the errors you'll see if you run
  `tsc`/`next build` here right now are 100% attributable to the missing
  `prisma generate` step, not a latent bug.
- The **one remaining untested step** is running `prisma generate` + `prisma migrate dev`
  against a real Postgres — **please run the commands below once, on a machine with normal
  internet access, and tell me if anything errors.** It's the standard first step for any
  Prisma project, not specific to this sandbox.

## Running it (on your machine, or any environment with normal internet access)

```bash
cp .env.example .env
# edit .env: set JWT_SECRET (openssl rand -base64 48) and a SEED_SUPERADMIN_EMAIL/PASSWORD

docker compose up -d          # starts local Postgres on :5432
npm install
npx prisma migrate dev --name init   # creates the database tables
npm run seed                          # seeds roles, permissions, and your SUPER_ADMIN user
npm run seed:real-branches            # (optional, once) loads your 6 real pharmacy branches
npm run dev                           # http://localhost:3000
```

Then:

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@example.com","password":"change-me-immediately"}'
```

should return the user object and set the `pacc_session` cookie; `GET /api/auth/me` with
that cookie should return the same user.

Then try Phase 2, reusing the cookie jar from login (`-c/-b cookies.txt` with curl, or your
HTTP client's cookie jar):

```bash
# create a branch
curl -i -X POST http://localhost:3000/api/branches -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"فرع الحمرا","address":"بيروت، الحمرا","whatsappNumber":"+9611234567"}'

# add a product to the catalog
curl -i -X POST http://localhost:3000/api/products -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"بندول اكسترا","brand":"GSK","type":"OTC","barcode":"6281234567890"}'

# first-stock it at the branch (use the real ids returned above)
curl -i -X POST http://localhost:3000/api/inventory -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"productId":"<productId>","branchId":"<branchId>","price":3.5,"lowStockThreshold":20}'

# receive stock (logs an inventory_transactions row)
curl -i -X POST http://localhost:3000/api/inventory/adjust -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"inventoryId":"<inventoryId>","type":"STOCK_IN","deltaQty":100,"note":"شحنة أولى"}'

# check alerts (should be empty right after a 100-unit stock-in above the 20-unit threshold)
curl -i http://localhost:3000/api/inventory/alerts -b cookies.txt
```

Then try Phase 3 — place an order (holds stock), confirm it (commits the stock), and walk
it through fulfillment:

```bash
# place an order — reserves 2 units against the inventory row from the Phase 2 example
curl -i -X POST http://localhost:3000/api/orders -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"branchId":"<branchId>","customerPhone":"+96170123456","customerName":"ربى خوري","items":[{"productId":"<productId>","qty":2}]}'

# confirm it (use the orderId from the response above) — this is where stock actually leaves
curl -i -X POST http://localhost:3000/api/orders/<orderId>/confirm -b cookies.txt

# walk it through fulfillment
curl -i -X POST http://localhost:3000/api/orders/<orderId>/advance -b cookies.txt \
  -H "Content-Type: application/json" -d '{"status":"PREPARING"}'

# cancelling a CONFIRMED order needs ORDERS_CANCEL — a 403 here is correct for a role that
# doesn't hold it (PHARMACY_EMPLOYEE, PHARMACIST); PHARMACY_MANAGER/ADMIN/SUPER_ADMIN can
curl -i -X POST http://localhost:3000/api/orders/<orderId>/cancel -b cookies.txt \
  -H "Content-Type: application/json" -d '{"reason":"العميل غيّر رأيه"}'

# the reservation-expiry sweep (manual for now — see "What's in Phase 3")
curl -i -X POST http://localhost:3000/api/orders/expire-reservations -b cookies.txt
```

Then try Phase 6 — onboard a driver, get an order ready for delivery, and walk a delivery
through its own lifecycle (still as the SUPER_ADMIN cookie jar from login above):

```bash
# onboard a driver account (USERS_MANAGE — SUPER_ADMIN only)
curl -i -X POST http://localhost:3000/api/drivers -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"خالد مراد","phone":"+96170999888","password":"driver-pass-123","vehicle":"دراجة نارية"}'

# a fresh order, confirmed and advanced to READY_FOR_DELIVERY (see the Phase 3 walkthrough
# above for what each step does)
curl -i -X POST http://localhost:3000/api/orders -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"branchId":"<branchId>","customerPhone":"+96170123456","customerName":"ربى خوري","items":[{"productId":"<productId>","qty":1}]}'
curl -i -X POST http://localhost:3000/api/orders/<orderId>/confirm -b cookies.txt
curl -i -X POST http://localhost:3000/api/orders/<orderId>/advance -b cookies.txt \
  -H "Content-Type: application/json" -d '{"status":"PREPARING"}'
curl -i -X POST http://localhost:3000/api/orders/<orderId>/advance -b cookies.txt \
  -H "Content-Type: application/json" -d '{"status":"READY_FOR_DELIVERY"}'

# assign the driver (use the driverId from the /api/drivers response above)
curl -i -X POST http://localhost:3000/api/deliveries -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"orderId":"<orderId>","driverId":"<driverId>"}'

# from here on, log in AS THE DRIVER (a separate cookie jar) to advance their own delivery —
# a dispatcher/manager could call the same /advance endpoint on any delivery instead
curl -i -X POST http://localhost:3000/api/auth/login -c driver-cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"identifier":"+96170999888","password":"driver-pass-123"}'
curl -i -X POST http://localhost:3000/api/deliveries/<deliveryId>/advance -b driver-cookies.txt \
  -H "Content-Type: application/json" -d '{"status":"ACCEPTED"}'
curl -i -X POST http://localhost:3000/api/deliveries/<deliveryId>/advance -b driver-cookies.txt \
  -H "Content-Type: application/json" -d '{"status":"PICKED_UP"}'
curl -i -X POST http://localhost:3000/api/deliveries/<deliveryId>/advance -b driver-cookies.txt \
  -H "Content-Type: application/json" -d '{"status":"ON_THE_WAY"}'
# ^ this call also flips the Order to OUT_FOR_DELIVERY and best-effort WhatsApp-notifies the
# customer — check `GET /api/orders/<orderId>` afterward to see the synced status

# if a delivery fails, retrying it means reassigning a driver (even the same one) — see
# src/lib/delivery.ts reassignDriver()'s comment for why there's no separate retry endpoint
curl -i -X POST http://localhost:3000/api/deliveries/<deliveryId>/reassign -b cookies.txt \
  -H "Content-Type: application/json" -d '{"driverId":"<driverId>"}'

# a driver's own active queue
curl -i http://localhost:3000/api/deliveries/mine -b driver-cookies.txt
```

Then try Phase 9 — the reports and the audit log (same SUPER_ADMIN cookie jar; drop
`?branchId=` to see the whole network instead of one branch):

```bash
# sales — revenue, order count, revenue-by-day, top products
curl -i "http://localhost:3000/api/reports/sales?branchId=<branchId>" -b cookies.txt

# same report over a date range
curl -i "http://localhost:3000/api/reports/sales?branchId=<branchId>&from=2026-09-01&to=2026-09-30" -b cookies.txt

# inventory valuation + alert counts (needs INVENTORY_READ too — PHARMACY_EMPLOYEE/
# PHARMACIST have REPORTS_READ but not this one, same ACCOUNTING-style exclusion)
curl -i "http://localhost:3000/api/reports/inventory-valuation?branchId=<branchId>" -b cookies.txt

# order status breakdown + approximate fulfillment time
curl -i "http://localhost:3000/api/reports/orders?branchId=<branchId>" -b cookies.txt

# delivery outcomes + per-driver breakdown
curl -i "http://localhost:3000/api/reports/delivery?branchId=<branchId>" -b cookies.txt

# log in as ACCOUNTING and confirm the 403 on a domain report (REPORTS_READ alone isn't
# enough) while /api/reports/sales and /api/audit both still work for them
curl -i "http://localhost:3000/api/reports/inventory-valuation?branchId=<branchId>" -b accounting-cookies.txt

# the audit log — the first time audit_logs is ever read back; try it after a few of the
# curls above (order/inventory/delivery actions) to see real rows
curl -i "http://localhost:3000/api/audit?limit=20" -b cookies.txt
curl -i "http://localhost:3000/api/audit?action=order.cancel" -b cookies.txt
```

Then try Phase 10's 2FA (as the SUPER_ADMIN cookie jar — ADMIN/SUPER_ADMIN only):

```bash
# step 1: get a pending secret + enrollment URI
curl -i -X POST http://localhost:3000/api/auth/2fa/setup -b cookies.txt
# add the returned "enrollmentUri" to an authenticator app (or compute a TOTP code from
# "base32Secret" with any RFC 6238 tool), then confirm with a CURRENT 6-digit code:

curl -i -X POST http://localhost:3000/api/auth/2fa/enable -b cookies.txt \
  -H "Content-Type: application/json" -d '{"token":"123456"}'

# from now on, logging in needs the code too
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@example.com","password":"change-me-immediately"}'
# ^ should now come back 401 with {"requiresTwoFactor":true} — no totpToken was sent

curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@example.com","password":"change-me-immediately","totpToken":"123456"}'
# ^ a current code should log in normally

# disabling it also needs a current code
curl -i -X POST http://localhost:3000/api/auth/2fa/disable -b cookies.txt \
  -H "Content-Type: application/json" -d '{"token":"123456"}'

# hammering the login endpoint (11th attempt in 10 minutes from the same identifier/IP
# should come back 429 instead of 401)
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" -d '{"identifier":"admin@example.com","password":"wrong"}'
done
```

Then run `prisma/manual-sql/qty_reserved_check.sql` once against your real database (see the
file's own header comment for how) to add the DB-level CHECK constraints.

Phase 5 has nothing to `curl` yet — it's triggered internally by the webhook, not a route
you call directly. Once `ANTHROPIC_API_KEY` is set in `.env` and you've re-run `npm run
seed` (to create the `AI_AGENT` role + the AI system user — see "What's prepared for Phase
5"), send a WhatsApp message to your test number from a conversation that's still
`assignedAgent: AI` (any new customer starts that way) and watch the server logs for
`[aiOrchestrator]` / `[whatsapp webhook]` lines; `GET /api/whatsapp/conversations/<id>`
afterward should show the AI's reply as an OUTBOUND message if it called
`send_whatsapp_message`.

## What's deliberately NOT done yet

- The admin dashboard UI (sidebar, modules) — Phase 11 territory, built once Phases 2-10
  give it real data to show. Phase 2 is API-only, same as Phase 1.
- **2FA enrollment has no QR-code UI** — `POST /api/auth/2fa/setup` returns the raw
  `otpauth://` URI and base32 secret; rendering that as a scannable QR image is Phase 11
  dashboard territory (or paste the URI into any TOTP tool that accepts one directly).
- **No admin-forced 2FA reset for a lost device** — disabling 2FA always requires a
  currently-valid code (self-service only, by design — see `src/app/api/auth/2fa/disable/
  route.ts`'s own comment for why a hastily-built "SUPER_ADMIN can reset anyone's 2FA"
  endpoint would itself be a security hole). A real lost-device recovery flow (backup
  codes, or an identity-verified admin override with its own audit trail) is still needed
  before this goes to production with 2FA actually enforced on real accounts.
- **2FA is opt-in per admin, not mandatory at the role level** — see "What's prepared for
  Phase 10" above for why: there's no enrollment UI yet to walk an ADMIN/SUPER_ADMIN through
  setup without risking a lockout.
- **Login rate limiting is per-server-instance, not distributed** — `src/lib/rateLimit.ts`
  is a plain in-memory map; running more than one app instance behind a load balancer
  multiplies the effective limit. A Redis-backed limiter belongs with the Background
  Jobs/Queue layer, which needs the same hosting decision Phase 10's table flags.
- **The Postgres CHECK constraints ship as a standalone SQL script, not a tracked
  migration** — `prisma/manual-sql/qty_reserved_check.sql` — because this sandbox could
  never run `prisma migrate dev` at all (see "Known limitation" below), so there's no
  `prisma/migrations/` history yet to add a real migration file to. Run it once by hand
  after your first `prisma migrate dev --name init`; the application layer
  (`adjustInventory` in `src/lib/inventory.ts`, and every reservation/confirm/cancel path in
  `src/lib/orders.ts`) already enforces the same rule in code regardless.
- **Secrets Manager, HTTPS termination, and daily DB backups are still infrastructure
  decisions, not code** — see the §16 checklist in "What's prepared for Phase 10" above;
  none of the three need a code change here, all three need you to pick a host.
- **Broader API rate limiting beyond login** — the plan doc's §16 names "Rate limiting"
  generally; only the brute-force-prone login endpoint got one in this pass. Extending it to
  every route (or moving it to the hosting layer's reverse proxy once that's chosen) is
  still open.
- **Storage provider now chosen (Cloudflare R2) but not yet live** — `src/lib/storage.ts`
  has a real `R2Adapter` now (see "Hosting & storage decision" near the top), but
  `getStorageAdapter()` still throws until `FILE_STORAGE_PROVIDER=r2` and the four `R2_*`
  values are actually filled in (`DEPLOY.md` step 5) — every Phase 8 route returns a clean
  `501` until then, same honest-failure posture as every other unconfigured integration here.
- **No multipart upload** — `POST /api/documents` takes a base64 JSON body; a real
  `multipart/form-data` endpoint (what a browser `<input type="file">` actually posts) is
  natural once there's a dashboard to upload from (Phase 11 territory).
- **No file-size limit, virus/malware scanning, or MIME-type sniffing beyond the
  client-declared `mimeType`** — nothing here re-derives the real file type from its bytes
  or caps upload size; both matter before accepting uploads from outside your own admin
  users (e.g. a future WhatsApp-media-to-Document pipeline).
- **No retry/backoff on the Anthropic classification call** — `classifyAndExtractText()`
  calls the API once; a transient failure just throws, same posture as `aiOrchestrator.ts`'s
  calls today (Phase 10's Background Jobs/Queue layer is the natural home for retries,
  across every external call in this project, not just this one).
- **OCR/classification is a single interpretation call, not a plan-doc decision** —
  reusing Anthropic (see "What's prepared for Phase 8") and the 6-category vocabulary are
  both choices made to keep this buildable without a new vendor account; swap either in
  `src/lib/documentAi.ts` if you want something else.
- A real approval *workflow* (a queued request + a second person's sign-off) for sensitive
  operations in the plan doc's §25 list (price changes, manual inventory edits, prescription
  dispensing, confirmed-order cancellation, etc.) — Phase 2/3 only gate these behind a
  permission (`PRICING_WRITE`, `ORDERS_CANCEL`), which is a necessary first layer but not
  the full approval flow; that's Phase 9+ territory.
- A real schedule for `releaseExpiredReservations()` — it exists and is correct, but
  nothing calls it automatically yet; that's Phase 10's Background Jobs/Queue layer. Until
  then, a HELD reservation past its 15-minute TTL just sits there (still correctly excluded
  from `confirmOrder()`, which refuses an expired hold) until something calls
  `POST /api/orders/expire-reservations`.
- The medication-safety distinction the plan doc requires (§7: a PRESCRIPTION or
  CONTROLLED product should force a "TRANSFER TO PHARMACIST" handoff) is NOT yet enforced
  at order creation — `createOrder()` will happily reserve a CONTROLLED product today. That
  handoff only makes sense once there's a WhatsApp/AI conversation to transfer (Phase 4/5),
  so it's deliberately deferred rather than bolted onto a plain REST call now; flagging it
  explicitly so it isn't mistaken for an oversight once Phase 5 lands.
- **Delivery → Order sync is two sequential calls, not one shared transaction** —
  `advanceDeliveryStatus()` commits the `Delivery` status change, then separately calls
  `orders.ts`'s `advanceOrderStatus()`. If the second call fails after the first commits,
  the `Delivery` is ahead of its `Order` (recoverable with a manual
  `POST /api/orders/[id]/advance`). Folding both into one transaction would mean exposing
  `orders.ts`'s transaction internals across module boundaries — a bigger refactor than
  Phase 6's scope; flagging it explicitly rather than quietly shipping a "mostly atomic"
  claim.
- **No admin UI to manage users or drivers** — `src/lib/users.ts`'s `createUser()` is
  intentionally minimal (one function, no listing/editing/deactivation), scoped just far
  enough to onboard a `DELIVERY_DRIVER` account. A real user-management screen is Phase 11
  territory, same as the rest of the admin dashboard.
- **No live driver location/tracking** — `Delivery` has no lat/lng or ETA; the plan doc
  doesn't call for live GPS tracking in this phase, and nothing here blocks adding it later
  (`Customer.locationLat/Lng` already exists for the drop-off side).
- **No delivery-fee/commission model** — `amountToCollect` is purely the order's own total;
  the plan doc doesn't specify a separate delivery fee or driver commission yet, so none is
  computed or stored.
- **No AI reply logic actually exercised yet** — the Tool Calling layer, the orchestrator
  loop, and the webhook wiring are all built (see "What's prepared for Phase 5" above), but
  none of it has run against a real model: there is still no `ANTHROPIC_API_KEY` in this
  sandbox. An `assignedAgent: AI` conversation today triggers `runAiTurn()`, which throws
  `AnthropicConfigError` immediately and gets logged as a warning — functionally identical
  to "no automatic response" from the customer's point of view, until a key is added.
- **Every branch's delivery is now wired to a real contact, but still a manual handoff by
  design** — `create_delivery` refuses to auto-pick an in-app driver for الجواد كير والعاصي
  and for the 4 Beirut branches, naming the real delivery contact (and company, for Beirut)
  instead (see "Real branch data + the Bekaa/Baalbek-Hermel routing rule" above); nothing
  here calls that number automatically or tracks whether the delivery actually happened — a
  human still does that part outside the app, same as CareLink. **Confirmed, not guessed:**
  there are no in-house drivers today — every delivery goes through one of these external
  lines — so the in-app `Driver`/`Delivery` pool (Phase 6) has no real branch to apply to
  right now; it's kept in the codebase as-is (not removed, not asked to be) for whenever
  that changes. The Bekaa/Baalbek-Hermel region match itself also only
  ever reads `Customer.address`, which nothing currently forces to be filled in before a
  search runs — a customer with no address on file simply gets no restriction applied (not
  an error, but also not necessarily right if they're actually in Bekaa/Baalbek-Hermel and
  just haven't given an address yet).
- **No background queue for the AI turn** — `runAiTurn()` runs synchronously inside the
  webhook request, same documented gap as `releaseExpiredReservations()` (Phase 10's job);
  a slow model response could push the webhook's own reply past Meta's expected ack time.
- **No conversation-length/token-budget handling** — `aiOrchestrator.ts` sends the entire
  message history every turn with no trimming or summarization; fine for a short
  back-and-forth, not yet designed for a long-running conversation.
- **`assign_pharmacy`'s branch selection is stock-only, not delivery-feasibility-aware** —
  it doesn't check whether a driver is actually available at the branch it picks (that's a
  separate `create_delivery` concern); the two tools aren't composed into one "can this
  branch both stock AND deliver this" check yet.
- WhatsApp delivery/read status receipts aren't persisted — `WhatsappMessage` has no status
  column yet; the webhook logs that it received them and drops them. Add a column + wire
  it up if/when a report actually needs delivery confirmation, rather than now on spec.
- Media messages (image/audio/document) are recorded as a placeholder string, not the
  actual file — Meta gives a short-lived media `id`, and downloading + storing it is
  Document AI's job (Phase 8), not Phase 4's.
- WhatsApp outbound send has no retry/backoff and isn't queued — `sendReply()` calls Meta
  synchronously inside the API request. Fine for a human clicking "send" in the inbox;
  Phase 5's AI replies and Phase 10's Background Jobs/Queue layer are where a real queue
  belongs if volume ever needs one.
- Rate limiting and webhook replay/dedup beyond the `waMessageId` uniqueness check — the
  plan doc's security section (§16) lists rate limiting generally; nothing WhatsApp-specific
  beyond what's described above exists yet.
- Document AI (Phase 8) — blocked on the file-storage decision (see "What's prepared for
  Phase 8"). CareLink (Phase 7) is no longer in this list — it's built (see "What's in Phase
  7" above): real inventory search, a real WhatsApp message to the branch, a real WhatsApp
  reply handled and parsed, a real order creation tagged `source: CARELINK`, and a real
  WhatsApp delivery notification. What remains there is infrastructure setup
  (`WHATSAPP_CARELINK_PHONE_NUMBER_ID`, registering CareLink's number under the Meta app) and
  two flagged, correctable assumptions (which number the final delivery notification goes to;
  the one-pending-inquiry-per-branch matching fallback), not an unbuilt feature.
  `CarelinkJob`/`create_carelink_job` remain unused and unchanged — still a real open decision
  (deprecate vs. keep) for you to make, not something resolved here.
- **No report caching/pre-aggregation** — every Phase 9 report re-queries and re-sums raw
  rows on every call (`getSalesReport()` loads every matching order + its items into memory
  each time). Fine at today's data volume; a materialized summary table or scheduled
  rollup is the natural next step once a branch has years of orders, not before.
- **No CSV/Excel export for any report** — all five Phase 9 endpoints return JSON only; the
  plan doc doesn't specify an export format yet, and building one speculatively risked
  guessing wrong about which columns matter to you.
- **No charts/dashboard UI for the reports** — same as every other phase's admin-dashboard
  gap (Phase 11 territory); Phase 9 is API-only, same posture as Phases 1-3.
- **Fulfillment/delivery time metrics are approximate, not exact** — see "What's in Phase
  9" above: the schema has no dedicated "delivered at" timestamp, so these use the row's
  `updatedAt`. Correct in practice (nothing else writes to a terminal-status row again), but
  flagged in the API response (`...IsApproximate: true`) rather than presented as precise.
- **No report-level pagination** — `listAuditLog()` caps at 500 rows (`?limit=`, default
  100); the other four reports return one aggregated object, not a row list, so pagination
  doesn't apply to them the same way. A branch with a very long audit history will need a
  narrower `?from=/&to=` window rather than paging through everything.

## Project plan

Full architecture, database rationale, order-lifecycle workflow, roles/security model, and
the decisions + credentials needed from you before later phases: see the linked doc shared
in chat (PHARMACY AI COMMAND CENTER).

## النشر (منذ 20 تشرين الثاني 2026)

المصدر الوحيد للكود هو هذا المستودع. كل دفع (push) إلى الفرع `main` يُنشر تلقائياً على Railway (مشروع adequate-nurturing، خدمة app). لا تستعمل `railway up` ولا ملفات .bat من نسخ سطح المكتب القديمة.
