-- Additive index. Creates nothing, drops nothing, rewrites no row.
--
-- Message is the only table in this app with no ceiling on growth, and two
-- hot paths filter it by direction with a createdAt range:
--   - rollupDay() counts INBOUND and OUTBOUND per day, twice per day, on
--     every inbound webhook;
--   - connectionStatus() takes the newest OUTBOUND row, and runs in the root
--     layout, so on every page request.
-- The only existing index is (contactId, createdAt), which neither can use.
--
-- NOT APPLIED by this phase: the database holds real Instagram contact data.
-- Apply it with:
--     npx prisma migrate deploy
-- On a large table, or to avoid the write lock, create it by hand instead and
-- then mark the migration applied:
--     CREATE INDEX CONCURRENTLY "Message_direction_createdAt_idx"
--       ON "Message"("direction", "createdAt");
--     npx prisma migrate resolve --applied 20260921000000_message_direction_created_at
-- (CONCURRENTLY cannot run inside the transaction prisma migrate opens, which
-- is why it is not written that way here.)

CREATE INDEX IF NOT EXISTS "Message_direction_createdAt_idx"
  ON "Message"("direction", "createdAt");
