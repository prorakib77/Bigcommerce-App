-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeHash" TEXT NOT NULL,
    "accountUuid" TEXT,
    "platformContext" TEXT,
    "encryptedAccessToken" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ownerBigcommerceUserId" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "store_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "bigcommerceUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "removedAt" DATETIME,
    CONSTRAINT "store_users_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kickflip_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "encryptedApiToken" TEXT,
    "tokenLastFour" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastVerifiedAt" DATETIME,
    "lastErrorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "disconnectedAt" DATETIME,
    CONSTRAINT "kickflip_connections_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "store_settings" (
    "storeId" TEXT NOT NULL PRIMARY KEY,
    "defaultCategoryIds" TEXT NOT NULL DEFAULT '[]',
    "defaultProductWeight" DECIMAL NOT NULL DEFAULT 0,
    "skuPrefix" TEXT NOT NULL DEFAULT 'KF',
    "defaultVisibility" BOOLEAN NOT NULL DEFAULT false,
    "importImages" BOOLEAN NOT NULL DEFAULT true,
    "updateImagesOnReimport" BOOLEAN NOT NULL DEFAULT true,
    "updateNameOnReimport" BOOLEAN NOT NULL DEFAULT true,
    "updatePriceOnReimport" BOOLEAN NOT NULL DEFAULT true,
    "updateDescriptionOnReimport" BOOLEAN NOT NULL DEFAULT true,
    "maxImagesPerDesign" INTEGER NOT NULL DEFAULT 8,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "store_settings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "import_mappings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "kickflipDesignId" TEXT NOT NULL,
    "kickflipNumericDesignId" INTEGER,
    "kickflipProductId" TEXT,
    "kickflipCustomizerProductId" TEXT,
    "bigcommerceProductId" INTEGER NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "sourceUpdatedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSuccessfulImportAt" DATETIME,
    "lastAttemptedImportAt" DATETIME,
    "orphaned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "import_mappings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "storeUserId" TEXT NOT NULL,
    "mappingId" TEXT,
    "kickflipDesignId" TEXT NOT NULL,
    "bigcommerceProductId" INTEGER,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "currentStage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "pgBossJobId" TEXT,
    "sourceFingerprint" TEXT,
    "optionsSnapshot" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "safeErrorCode" TEXT,
    "safeErrorMessage" TEXT,
    "internalErrorRef" TEXT,
    "correlationId" TEXT NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "import_runs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "import_runs_storeUserId_fkey" FOREIGN KEY ("storeUserId") REFERENCES "store_users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "import_runs_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "import_mappings" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "storeUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "safeMetadata" JSONB,
    "correlationId" TEXT,
    "requestIdentifier" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audit_logs_storeUserId_fkey" FOREIGN KEY ("storeUserId") REFERENCES "store_users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "app_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "storeUserId" TEXT NOT NULL,
    "hashedTokenId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_sessions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "app_sessions_storeUserId_fkey" FOREIGN KEY ("storeUserId") REFERENCES "store_users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeUserId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "queue_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "queueName" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CREATED',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retryLimit" INTEGER NOT NULL DEFAULT 5,
    "startAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expireAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
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

-- CreateIndex
CREATE INDEX "queue_jobs_queueName_state_startAfter_idx" ON "queue_jobs"("queueName", "state", "startAfter");

-- CreateIndex
CREATE INDEX "queue_jobs_queueName_groupId_state_idx" ON "queue_jobs"("queueName", "groupId", "state");
