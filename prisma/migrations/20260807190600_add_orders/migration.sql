-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "ordersWebhookId" INTEGER,
ADD COLUMN     "ordersWebhookSecret" TEXT,
ADD COLUMN     "ordersWebhookRegisteredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "bigcommerceOrderId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "statusId" INTEGER,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "totalIncTax" TEXT NOT NULL,
    "currencyCode" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "orderCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_storeId_orderCreatedAt_idx" ON "orders"("storeId", "orderCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_storeId_bigcommerceOrderId_key" ON "orders"("storeId", "bigcommerceOrderId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
