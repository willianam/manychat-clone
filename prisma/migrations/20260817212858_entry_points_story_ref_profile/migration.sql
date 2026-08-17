-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TriggerKind" ADD VALUE 'STORY_MENTION';
ALTER TYPE "TriggerKind" ADD VALUE 'REF';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "RefLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "iceBreakers" JSONB NOT NULL DEFAULT '[]',
    "menuItems" JSONB NOT NULL DEFAULT '[]',
    "syncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessengerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefLink_code_key" ON "RefLink"("code");

-- CreateIndex
CREATE INDEX "RefLink_enabled_idx" ON "RefLink"("enabled");

-- AddForeignKey
ALTER TABLE "RefLink" ADD CONSTRAINT "RefLink_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
