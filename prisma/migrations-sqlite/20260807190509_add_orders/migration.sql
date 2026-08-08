-- AlterTable
ALTER TABLE "stores" ADD COLUMN "ordersWebhookId" INTEGER;
ALTER TABLE "stores" ADD COLUMN "ordersWebhookRegisteredAt" DATETIME;
ALTER TABLE "stores" ADD COLUMN "ordersWebhookSecret" TEXT;

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "bigcommerceOrderId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "statusId" INTEGER,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "totalIncTax" TEXT NOT NULL,
    "currencyCode" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "orderCreatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "orders_storeId_orderCreatedAt_idx" ON "orders"("storeId", "orderCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_storeId_bigcommerceOrderId_key" ON "orders"("storeId", "bigcommerceOrderId");
