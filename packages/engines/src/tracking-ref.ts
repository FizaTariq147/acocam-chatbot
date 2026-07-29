/** Shared tracking reference detection for pipeline and workflow validators. */

const TRACKING_STOPWORDS = new Set(
  [
    'shipment', 'shipping', 'services', 'service', 'tracking', 'package', 'packages',
    'container', 'freight', 'customs', 'document', 'documents', 'worldwide',
    'individual', 'business', 'customer', 'destination', 'destinations',
    'quotation', 'quotations', 'acocam', 'trading', 'canada', 'africa', 'vehicle',
    'motorcycle', 'personal', 'effects', 'commercial', 'support',
  ].map((w) => w.toLowerCase()),
);

const TRACKING_REF_RE =
  /\b(?:ACO[- ]?\d{4,}|(?=[A-Z0-9-]*\d)(?![A-Z]*$)[A-Z0-9-]{6,})\b/gi;

export function looksLikeTrackingRef(value: string): boolean {
  const v = value.trim();
  if (v.length < 6) return false;
  if (!/\d/.test(v)) return false;
  if (/\s/.test(v) && !/^ACO[- ]?\d{4,}$/i.test(v)) return false;
  if (TRACKING_STOPWORDS.has(v.toLowerCase())) return false;
  return /^(?:ACO[- ]?\d{4,}|(?=[A-Z0-9-]*\d)[A-Z0-9-]{6,})$/i.test(v.replace(/\s+/g, ''));
}

export function extractTrackingNumber(message: string): string | undefined {
  const matches = message.match(TRACKING_REF_RE) ?? [];
  for (const raw of matches.reverse()) {
    const cleaned = raw.replace(/\s+/g, '').toUpperCase();
    if (TRACKING_STOPWORDS.has(cleaned.toLowerCase())) continue;
    if (!/\d/.test(cleaned)) continue;
    if (cleaned.length < 5) continue;
    return cleaned;
  }
  return undefined;
}
