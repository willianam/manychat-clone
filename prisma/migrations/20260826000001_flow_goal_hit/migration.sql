-- CreateTable
CREATE TABLE "FlowGoalHit" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowGoalHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlowGoalHit_flowId_nodeId_idx" ON "FlowGoalHit"("flowId", "nodeId");

-- CreateIndex
CREATE INDEX "FlowGoalHit_sessionId_idx" ON "FlowGoalHit"("sessionId");
