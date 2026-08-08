import sanitizeHtml from 'sanitize-html';
import type { NormalizedKickflipDesign } from '@/lib/kickflip';

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'ul', 'li', 'strong', 'em', 'br'],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

/**
 * Builds the BigCommerce product description from normalized, already-safe
 * design data: name and a plain customization summary only. Never includes
 * credentials, raw API payloads, or anything sourced from a customer. The
 * template below is run through `sanitize-html` regardless — defense in
 * depth against a design field ever containing unexpected markup.
 */
export function buildProductDescriptionHtml(design: NormalizedKickflipDesign): string {
  const summaryItems = design.summary
    .slice(0, 20)
    .map((item) => `<li><strong>${item.label}:</strong> ${item.value}</li>`)
    .join('');

  const html = `<p>${design.name}</p>${summaryItems ? `<ul>${summaryItems}</ul>` : ''}`;

  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
