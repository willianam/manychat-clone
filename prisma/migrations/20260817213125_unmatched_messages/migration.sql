-- CreateTable
CREATE TABLE "UnmatchedMessage" (
    "id" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "sample" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastContactId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnmatchedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnmatchedMessage_normalized_key" ON "UnmatchedMessage"("normalized");

-- CreateIndex
CREATE INDEX "UnmatchedMessage_resolvedAt_count_idx" ON "UnmatchedMessage"("resolvedAt", "count");

-- CreateIndex
CREATE INDEX "UnmatchedMessage_lastSeenAt_idx" ON "UnmatchedMessage"("lastSeenAt");
