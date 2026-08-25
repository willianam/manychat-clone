-- AlterTable
ALTER TABLE "Flow" ADD COLUMN "draftGraph" JSONB,
ADD COLUMN "publishedAt" TIMESTAMP(3);
