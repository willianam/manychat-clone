-- CreateTable
CREATE TABLE "IgCredential" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgCredential_pkey" PRIMARY KEY ("id")
);
