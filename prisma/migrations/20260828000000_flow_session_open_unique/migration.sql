-- A full unique on (contactId, flowId, status) let a contact reach COMPLETED
-- in a given flow exactly once: the second completion collided with the first
-- COMPLETED row, so every recurring contact was left with an orphan ACTIVE
-- session and startFlow refused all later runs of that flow.
--
-- The rule we actually want is "at most one OPEN run per contact per flow".
-- That is a partial unique index, which Prisma's schema language cannot
-- express, so it is declared here in raw SQL.

DROP INDEX IF EXISTS "FlowSession_contactId_flowId_status_key";

CREATE UNIQUE INDEX "FlowSession_open_unique"
  ON "FlowSession" ("contactId", "flowId")
  WHERE status IN ('ACTIVE', 'WAITING_INPUT');
