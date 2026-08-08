-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "storefrontScriptUuid" TEXT,
ADD COLUMN     "storefrontScriptRegisteredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "product_customize_configs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "bigcommerceProductId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "customizeUrl" TEXT,
    "buttonLabel" TEXT NOT NULL DEFAULT 'Customize',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_customize_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_customize_configs_storeId_bigcommerceProductId_key" ON "product_customize_configs"("storeId", "bigcommerceProductId");

-- AddForeignKey
ALTER TABLE "product_customize_configs" ADD CONSTRAINT "product_customize_configs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
