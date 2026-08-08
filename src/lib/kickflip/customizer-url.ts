const TOKEN = '{customizerProductId}';

/**
 * Builds a *suggested* storefront Customize URL from a Kickflip customizer
 * product id and a configurable template (KICKFLIP_CUSTOMIZER_BASE_URL).
 * Never fabricates a broken/static URL — returns null unless both inputs are
 * present and the template actually contains the substitution token.
 *
 * FLAG: there is no confirmed real-world Kickflip customizer embed URL
 * pattern this app has verified — the template is merchant/operator
 * configured precisely because the real shape is unknown. See
 * docs/api-assumptions.md.
 */
export function buildKickflipCustomizerUrl(
  customizerProductId: string | null,
  template: string,
): string | null {
  if (!customizerProductId || !template) return null;
  if (!template.includes(TOKEN)) return null;
  return template.split(TOKEN).join(encodeURIComponent(customizerProductId));
}
