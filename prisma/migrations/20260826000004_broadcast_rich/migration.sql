-- AlterTable
ALTER TABLE "Broadcast" ALTER COLUMN "text" DROP NOT NULL,
ADD COLUMN     "content" JSONB,
ADD COLUMN     "flowId" TEXT,
ADD COLUMN     "tag" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
