-- AlterTable
ALTER TABLE "stores" ADD COLUMN "storefrontScriptRegisteredAt" DATETIME;
ALTER TABLE "stores" ADD COLUMN "storefrontScriptUuid" TEXT;

-- CreateTable
CREATE TABLE "product_customize_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "bigcommerceProductId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "customizeUrl" TEXT,
    "buttonLabel" TEXT NOT NULL DEFAULT 'Customize',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "product_customize_configs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "product_customize_configs_storeId_bigcommerceProductId_key" ON "product_customize_configs"("storeId", "bigcommerceProductId");
