-- AlterTable
ALTER TABLE "FlowSession" ADD COLUMN     "abandonedAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FlowSession_flowId_startedAt_idx" ON "FlowSession"("flowId", "startedAt");
