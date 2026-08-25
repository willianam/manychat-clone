-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3);

-- Rows from before this column existed were processed inline.
UPDATE "WebhookEvent" SET "processedAt" = "receivedAt", "attempts" = 1 WHERE "processedAt" IS NULL;

-- CreateIndex
CREATE INDEX "WebhookEvent_processedAt_attempts_idx" ON "WebhookEvent"("processedAt", "attempts");
