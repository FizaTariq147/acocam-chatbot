/**
 * ACOCAM-branded conversational helpers.
 * Used when retrieval is weak/empty so the bot still sounds like a helpful human agent —
 * never mentions "knowledge base" gaps.
 */

export function topicHints(message: string): string[] {
  const m = message.toLowerCase();
  const hints: string[] = [];
  if (/\b(price|cost|rate|rates|fee|how much|expensive|cheap|quotation|quote)\b/.test(m)) hints.push('pricing');
  if (/\b(track|tracking|where is|status|awb|b\/l|bol)\b/.test(m)) hints.push('tracking');
  if (/\b(document|paperwork|invoice|packing list|certificate|customs)\b/.test(m)) hints.push('documents');
  if (/\b(lcl|fcl|container|ocean|sea|air|vehicle|car|parcel|warehouse)\b/.test(m)) hints.push('services');
  if (/\b(contact|phone|email|office|address|located|hours)\b/.test(m)) hints.push('contact');
  if (/\b(book|booking|ship my|send my|arrange)\b/.test(m)) hints.push('booking');
  if (/\b(time|how long|transit|days|weeks|eta|delivery)\b/.test(m)) hints.push('transit');
  if (/\b(insurance|insured|cover)\b/.test(m)) hints.push('insurance');
  if (/\b(africa|cameroon|canada|montreal|destination|route)\b/.test(m)) hints.push('routes');
  return hints;
}

/** Helpful ACOCAM reply when we cannot pin an exact FAQ — never invent prices/status. */
export function acocamHumanFallback(userMessage: string): string {
  const hints = topicHints(userMessage);
  const primary = hints[0];

  switch (primary) {
    case 'pricing':
      return [
        'Happy to help with pricing.',
        'At ACOCAM, shipping cost depends on cargo type, dimensions/weight, origin, destination, and the service you choose (ocean FCL/LCL, air freight, vehicle, or parcel).',
        'I never invent a final price in chat — our specialists confirm official rates after review.',
        '',
        'Share your origin, destination, and cargo details and I can guide a quote, or use **Get a quote** on https://acocamtrading.ca/get-quote/.',
      ].join('\n');

    case 'tracking':
      return [
        'I can help you track a shipment.',
        'Please share your tracking / file / AWB / B/L number (for example ACO-1234), and I will look it up in the ACOCAM system.',
        'You can also use **Track Now** on https://acocamtrading.ca/.',
      ].join('\n');

    case 'documents':
      return [
        'For documentation, ACOCAM typically works with commercial invoices, packing lists, and any certificates required for your route and cargo.',
        'Exact documents depend on origin, destination, commodity, and whether customs clearance is included.',
        '',
        'Tell me the cargo type and corridor (for example Canada → Cameroon), and I will point you in the right direction — or connect you with a human specialist for complex cases.',
      ].join('\n');

    case 'services':
      return [
        'ACOCAM Trading Inc. supports international logistics including ocean freight (FCL and LCL), air freight, vehicle shipping, parcels and personal effects, warehousing support, and logistics documentation.',
        '',
        'Tell me what you need to move (cargo type, origin, and destination), and I will guide you to the right next step — quote, tracking, or a human agent.',
      ].join('\n');

    case 'contact':
      return [
        'You can reach ACOCAM through https://acocamtrading.ca/ (login / Get a quote), or ask me for the contact details we publish for customers.',
        'If your matter is urgent or account-specific, I can also connect you with a human agent.',
      ].join('\n');

    case 'booking':
      return [
        'I can help you start a booking or quote request.',
        'I collect the shipment details and connect you with the ACOCAM team — bookings become official only after availability, quote acceptance, documents, and payment are confirmed.',
        '',
        'Tap **Get a quote**, or tell me origin, destination, and cargo type to begin.',
      ].join('\n');

    case 'transit':
      return [
        'Transit time depends on the mode (ocean vs air), route, carrier schedule, and customs.',
        'Ocean freight is usually longer; air is faster for urgent cargo. ACOCAM confirms expected timing on the official quote — I do not invent guaranteed delivery dates in chat.',
        '',
        'Share your corridor and service type if you want a more specific guide, or request a quote for a reviewed estimate.',
      ].join('\n');

    case 'insurance':
      return [
        'Cargo insurance is available on request and is included only when it is expressly confirmed in writing on your ACOCAM quote or contract.',
        'If you need coverage, mention it when requesting a quote so our team can advise you.',
      ].join('\n');

    case 'routes':
      return [
        'ACOCAM serves many destinations in Africa and worldwide, with strong activity on Canada ↔ Africa corridors. Availability always depends on the exact route, cargo, carrier, and local requirements.',
        '',
        'Tell me your origin and destination and I will help you start a quote review with our team.',
      ].join('\n');

    default:
      return [
        'Thanks for reaching out — I’m here to help as your ACOCAM assistant.',
        'We support international logistics: ocean freight (FCL/LCL), air freight, vehicle shipping, parcels, personal effects, import-export, and documentation.',
        '',
        'Could you share a little more detail (for example: quote, tracking number, cargo type, or origin/destination)?',
        'I can also connect you with a human agent anytime — just say **talk to human**.',
      ].join('\n');
  }
}

/**
 * Light human touch on retrieved FAQ answers without changing facts.
 * Avoids robotic "knowledge dump" feel for paraphrased questions.
 */
export function humanizeRetrievedAnswer(
  answer: string,
  userMessage: string,
  opts?: { customerName?: string; priorIntent?: string | null },
): string {
  const text = answer.trim();
  if (!text) return acocamHumanFallback(userMessage);

  const m = userMessage.trim().toLowerCase();
  const name = opts?.customerName?.trim();
  const namePrefix = name ? `${name}, ` : '';

  // Already conversational greetings / thanks — leave as authored
  if (/^(hi|hello|hey|thanks|thank you|bye|goodbye|good\s*(morning|afternoon|evening))\b/.test(m)) {
    return text;
  }

  // Don't stack openers if the answer already sounds spoken
  if (/^(sure|absolutely|happy to|of course|thanks|you('re| are) welcome|hello|hi\b)/i.test(text)) {
    return name && !text.toLowerCase().includes(name.toLowerCase()) ? `${name}, ${text}` : text;
  }

  if (/^(what|explain|tell me|can you explain|how does)\b/.test(m)) {
    return `Sure${name ? `, ${name}` : ''} — here’s how it works at ACOCAM:\n\n${text}`;
  }
  if (/^(do you|does acocam|can you|is it possible)\b/.test(m)) {
    return `Yes${name ? `, ${name}` : ''} — from the ACOCAM side:\n\n${text}`;
  }
  if (/\b(how much|cost|price)\b/.test(m)) {
    return `${namePrefix}${text}\n\nIf you’d like, share origin, destination, and cargo details and I can guide a formal quote request.`;
  }
  if (opts?.priorIntent?.startsWith('quote') && /\b(document|track|lcl|fcl|air|vehicle)\b/.test(m)) {
    return `${namePrefix}${text}\n\nWhenever you’re ready, we can continue your quote request as well.`;
  }

  return name ? `${name} — ${text}` : text;
}
