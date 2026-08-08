/** Deterministic `<prefix>-<stable-design-id>` SKU, sanitized to characters BigCommerce accepts. */
export function generateSku(prefix: string, stableDesignId: string): string {
  const sanitizedPrefix = (prefix.trim() || 'KF').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const sanitizedId = stableDesignId
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-');
  const sku = `${sanitizedPrefix || 'KF'}-${sanitizedId}`;
  return sku.slice(0, 100);
}
