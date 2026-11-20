-- Phase 10 security/data-integrity hardening.
--
-- Prisma's schema DSL (schema.prisma) cannot express a multi-column CHECK constraint
-- directly, so this has to be applied by hand with raw SQL — the application layer
-- (adjustInventory() in src/lib/inventory.ts, and every reservation/confirm/cancel path in
-- src/lib/orders.ts) already enforces qtyReserved <= qtyOnHand in code, but a DB-level
-- constraint is the real backstop against a future bug, a manual psql UPDATE, or a bypass
-- of the application layer entirely.
--
-- Run this ONCE, after `prisma migrate dev --name init` has created the "inventory" table
-- (there is no prisma/migrations folder yet in this delivery — this sandbox could never run
-- `prisma migrate dev` at all, see README's "Known limitation in THIS sandbox" — so this
-- can't be folded into a numbered migration file here; add it to your own migration history
-- however you manage migrations, or just run it directly against the database once):
--
--   psql "$DATABASE_URL" -f prisma/manual-sql/qty_reserved_check.sql
--
-- or paste it into `prisma studio` / any SQL client connected to the same database.

ALTER TABLE "inventory"
  ADD CONSTRAINT qty_reserved_not_exceeding_on_hand
  CHECK ("qtyReserved" <= "qtyOnHand");

-- Also guards against a negative value ever being written to either column directly (the
-- application layer already refuses this, but a raw SQL UPDATE wouldn't know that).
ALTER TABLE "inventory"
  ADD CONSTRAINT qty_on_hand_not_negative
  CHECK ("qtyOnHand" >= 0);

ALTER TABLE "inventory"
  ADD CONSTRAINT qty_reserved_not_negative
  CHECK ("qtyReserved" >= 0);
