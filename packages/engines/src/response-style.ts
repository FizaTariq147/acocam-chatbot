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

/** French fallback when retrieval is weak — mirrors English topics. */
export function acocamHumanFallbackFr(userMessage: string): string {
  const hints = topicHints(userMessage);
  const primary = hints[0];

  switch (primary) {
    case 'pricing':
      return [
        'Je peux vous aider avec les tarifs.',
        'Chez ACOCAM, le coût dépend du type de cargo, dimensions/poids, origine, destination et service choisi (FCL/LCL, fret aérien, véhicule ou colis).',
        'Je n’invente jamais de prix final ici — nos spécialistes confirment les tarifs officiels après examen.',
        '',
        'Partagez origine, destination et détails de la marchandise, ou utilisez **Obtenir un devis** sur https://acocamtrading.ca/get-quote/.',
      ].join('\n');

    case 'tracking':
      return [
        'Je peux vous aider à suivre un envoi.',
        'Partagez votre numéro de dossier / suivi / AWB / connaissement (ex. ACO-1234) et je le consulterai dans le système ACOCAM.',
        'Vous pouvez aussi utiliser **Suivi** sur https://acocamtrading.ca/.',
      ].join('\n');

    case 'documents':
      return [
        'Pour la documentation, ACOCAM utilise généralement factures commerciales, listes de colisage et certificats requis selon la route et le cargo.',
        'Les documents exacts dépendent de l’origine, destination, marchandise et du dédouanement.',
        '',
        'Indiquez le type de cargo et le corridor (ex. Canada → Cameroun), ou demandez un agent pour les cas complexes.',
      ].join('\n');

    case 'services':
      return [
        'ACOCAM Trading Inc. offre la logistique internationale : fret maritime (FCL et LCL), fret aérien, véhicules, colis et effets personnels, entreposage et documentation.',
        '',
        'Dites-moi ce que vous devez expédier (type, origine, destination) et je vous guiderai — devis, suivi ou agent humain.',
      ].join('\n');

    case 'contact':
      return [
        'Vous pouvez joindre ACOCAM via https://acocamtrading.ca/ (connexion / devis), ou me demander les coordonnées publiées.',
        'Pour les urgences ou questions de compte, je peux aussi vous connecter à un agent.',
      ].join('\n');

    case 'booking':
      return [
        'Je peux vous aider à démarrer une réservation ou demande de devis.',
        'Je recueille les détails et vous connecte avec l’équipe ACOCAM — la réservation devient officielle après disponibilité, acceptation du devis, documents et paiement.',
        '',
        'Utilisez **Obtenir un devis**, ou indiquez origine, destination et type de cargo.',
      ].join('\n');

    default:
      return [
        'Merci de nous avoir contactés — je suis votre assistant ACOCAM.',
        'Nous offrons la logistique internationale : fret maritime (FCL/LCL), fret aérien, véhicules, colis, effets personnels, import-export et documentation.',
        '',
        'Pouvez-vous préciser (devis, numéro de suivi, type de cargo, origine/destination) ?',
        'Je peux aussi vous connecter à un agent — dites **parler à un agent**.',
      ].join('\n');
  }
}

export function acocamHumanFallbackLocalized(userMessage: string, language = 'en'): string {
  return language === 'fr' ? acocamHumanFallbackFr(userMessage) : acocamHumanFallback(userMessage);
}

/**
 * Light human touch on retrieved FAQ answers without changing facts.
 * Avoids robotic "knowledge dump" feel for paraphrased questions.
 */
export function humanizeRetrievedAnswer(
  answer: string,
  userMessage: string,
  opts?: { customerName?: string; priorIntent?: string | null; language?: string },
): string {
  const text = answer.trim();
  const lang = opts?.language === 'fr' ? 'fr' : 'en';
  if (!text) return acocamHumanFallbackLocalized(userMessage, lang);

  const m = userMessage.trim().toLowerCase();
  const name = opts?.customerName?.trim();
  const namePrefix = name ? `${name}, ` : '';

  // Already conversational greetings / thanks — leave as authored
  const mNorm = m.normalize('NFD').replace(/\p{M}/gu, '');
  if (/^(hi|hello|hey|thanks|thank you|bye|goodbye|good\s*(morning|afternoon|evening)|bonjour|salut|comment ca va|comment allez|merci|au revoir)\b/.test(mNorm)) {
    return text;
  }

  // Don't stack openers if the answer already sounds spoken
  const spokenStart =
    lang === 'fr'
      ? /^(bien sûr|absolument|avec plaisir|bien entendu|merci|je vous en prie|bonjour|salut)\b/i
      : /^(sure|absolutely|happy to|of course|thanks|you('re| are) welcome|hello|hi\b)/i;
  if (spokenStart.test(text)) {
    return name && !text.toLowerCase().includes(name.toLowerCase()) ? `${name}, ${text}` : text;
  }

  if (lang === 'fr') {
    if (/^(qu['']est|explique|dis-moi|peux-tu|comment fonctionne|comment marche)\b/.test(mNorm)) {
      return `Bien sûr${name ? `, ${name}` : ''} — voici comment cela fonctionne chez ACOCAM :\n\n${text}`;
    }
    if (/^(est-ce|acocam|pouvez|peut-on|est-il possible)\b/.test(mNorm)) {
      return `Oui${name ? `, ${name}` : ''} — côté ACOCAM :\n\n${text}`;
    }
    if (/\b(combien|co[uû]t|prix|tarif)\b/.test(mNorm)) {
      return `${namePrefix}${text}\n\nSi vous le souhaitez, indiquez l'origine, la destination et les détails de la marchandise — je pourrai vous guider pour une demande de devis officielle.`;
    }
    if (opts?.priorIntent?.startsWith('quote') && /\b(document|suivi|lcl|fcl|a[eé]rien|v[eé]hicule)\b/.test(mNorm)) {
      return `${namePrefix}${text}\n\nQuand vous serez prêt, nous pourrons aussi poursuivre votre demande de devis.`;
    }
    return name ? `${name} — ${text}` : text;
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
