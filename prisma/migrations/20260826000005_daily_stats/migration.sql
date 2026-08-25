-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "unsubscribedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DailyStat" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerFire" (
    "id" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriggerFire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyStat_date_metric_key_key" ON "DailyStat"("date", "metric", "key");

-- CreateIndex
CREATE INDEX "DailyStat_metric_date_idx" ON "DailyStat"("metric", "date");

-- CreateIndex
CREATE INDEX "TriggerFire_at_idx" ON "TriggerFire"("at");

-- CreateIndex
CREATE INDEX "TriggerFire_triggerId_at_idx" ON "TriggerFire"("triggerId", "at");
