-- CreateEnum
CREATE TYPE "StoreUserRole" AS ENUM ('OWNER', 'USER');

-- CreateEnum
CREATE TYPE "KickflipConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ImportMappingStatus" AS ENUM ('ACTIVE', 'ORPHANED');

-- CreateEnum
CREATE TYPE "ImportOperation" AS ENUM ('IMPORT_DESIGN', 'UPDATE_DESIGN', 'RETRY_IMAGES', 'RECONCILE_MAPPING', 'RECREATE_PRODUCT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'FETCHING_SOURCE', 'VALIDATING_SOURCE', 'CREATING_PRODUCT', 'UPDATING_PRODUCT', 'PROCESSING_IMAGES', 'WRITING_METADATA', 'FINALIZING', 'SUCCEEDED', 'SKIPPED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "storeHash" TEXT NOT NULL,
    "accountUuid" TEXT,
    "platformContext" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ownerBigcommerceUserId" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_users" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "bigcommerceUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StoreUserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "store_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kickflip_connections" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "encryptedApiToken" TEXT,
    "tokenLastFour" TEXT,
    "status" "KickflipConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "kickflip_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_settings" (
    "storeId" TEXT NOT NULL,
    "defaultCategoryIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "defaultProductWeight" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "skuPrefix" TEXT NOT NULL DEFAULT 'KF',
    "defaultVisibility" BOOLEAN NOT NULL DEFAULT false,
    "importImages" BOOLEAN NOT NULL DEFAULT true,
    "updateImagesOnReimport" BOOLEAN NOT NULL DEFAULT true,
    "updateNameOnReimport" BOOLEAN NOT NULL DEFAULT true,
    "updatePriceOnReimport" BOOLEAN NOT NULL DEFAULT true,
    "updateDescriptionOnReimport" BOOLEAN NOT NULL DEFAULT true,
    "maxImagesPerDesign" INTEGER NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "import_mappings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kickflipDesignId" TEXT NOT NULL,
    "kickflipNumericDesignId" INTEGER,
    "kickflipProductId" TEXT,
    "kickflipCustomizerProductId" TEXT,
    "bigcommerceProductId" INTEGER NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "status" "ImportMappingStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSuccessfulImportAt" TIMESTAMP(3),
    "lastAttemptedImportAt" TIMESTAMP(3),
    "orphaned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeUserId" TEXT NOT NULL,
    "mappingId" TEXT,
    "kickflipDesignId" TEXT NOT NULL,
    "bigcommerceProductId" INTEGER,
    "operation" "ImportOperation" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sourceFingerprint" TEXT,
    "optionsSnapshot" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "safeErrorCode" TEXT,
    "safeErrorMessage" TEXT,
    "internalErrorRef" TEXT,
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "safeMetadata" JSONB,
    "correlationId" TEXT,
    "requestIdentifier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_sessions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeUserId" TEXT NOT NULL,
    "hashedTokenId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_storeHash_key" ON "stores"("storeHash");

-- CreateIndex
CREATE INDEX "stores_isActive_idx" ON "stores"("isActive");

-- CreateIndex
CREATE INDEX "store_users_storeId_isActive_idx" ON "store_users"("storeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "store_users_storeId_bigcommerceUserId_key" ON "store_users"("storeId", "bigcommerceUserId");

-- CreateIndex
CREATE UNIQUE INDEX "kickflip_connections_storeId_key" ON "kickflip_connections"("storeId");

-- CreateIndex
CREATE INDEX "import_mappings_storeId_status_idx" ON "import_mappings"("storeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_mappings_storeId_kickflipDesignId_key" ON "import_mappings"("storeId", "kickflipDesignId");

-- CreateIndex
CREATE UNIQUE INDEX "import_mappings_storeId_bigcommerceProductId_key" ON "import_mappings"("storeId", "bigcommerceProductId");

-- CreateIndex
CREATE UNIQUE INDEX "import_runs_idempotencyKey_key" ON "import_runs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "import_runs_storeId_status_idx" ON "import_runs"("storeId", "status");

-- CreateIndex
CREATE INDEX "import_runs_storeId_kickflipDesignId_idx" ON "import_runs"("storeId", "kickflipDesignId");

-- CreateIndex
CREATE INDEX "import_runs_storeId_createdAt_idx" ON "import_runs"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_storeId_createdAt_idx" ON "audit_logs"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_storeId_entityType_entityId_idx" ON "audit_logs"("storeId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "app_sessions_hashedTokenId_key" ON "app_sessions"("hashedTokenId");

-- CreateIndex
CREATE INDEX "app_sessions_expiresAt_idx" ON "app_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "app_sessions_storeUserId_idx" ON "app_sessions"("storeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_tokens_tokenHash_key" ON "one_time_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "one_time_tokens_expiresAt_idx" ON "one_time_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "store_users" ADD CONSTRAINT "store_users_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kickflip_connections" ADD CONSTRAINT "kickflip_connections_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_storeUserId_fkey" FOREIGN KEY ("storeUserId") REFERENCES "store_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "import_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_storeUserId_fkey" FOREIGN KEY ("storeUserId") REFERENCES "store_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_storeUserId_fkey" FOREIGN KEY ("storeUserId") REFERENCES "store_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
