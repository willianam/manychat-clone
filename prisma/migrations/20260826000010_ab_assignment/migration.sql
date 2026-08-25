-- CreateTable
CREATE TABLE "AbAssignment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AbAssignment_sessionId_nodeId_key" ON "AbAssignment"("sessionId", "nodeId");

-- CreateIndex
CREATE INDEX "AbAssignment_flowId_nodeId_idx" ON "AbAssignment"("flowId", "nodeId");
