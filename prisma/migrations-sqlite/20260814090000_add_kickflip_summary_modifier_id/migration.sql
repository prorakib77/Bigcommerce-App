-- Add a second auto-created BigCommerce modifier for the readable Kickflip
-- customization summary displayed on cart/order line items.
ALTER TABLE "product_customize_configs" ADD COLUMN "kickflipSummaryModifierId" INTEGER;
