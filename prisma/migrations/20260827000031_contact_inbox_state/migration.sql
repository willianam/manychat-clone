-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "automationPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastReadAt" TIMESTAMP(3);

-- Backfill: order existing conversations by their newest message.
UPDATE "Contact" c
SET "lastMessageAt" = m."at"
FROM (SELECT "contactId", MAX("createdAt") AS "at" FROM "Message" GROUP BY "contactId") m
WHERE m."contactId" = c."id";

-- CreateIndex
CREATE INDEX "Contact_lastMessageAt_idx" ON "Contact"("lastMessageAt");
