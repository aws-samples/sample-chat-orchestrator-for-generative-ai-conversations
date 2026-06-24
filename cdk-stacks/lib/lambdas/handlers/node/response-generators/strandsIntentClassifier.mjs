const { Agent, BedrockModel } = require('@strands-agents/sdk')
const z = require('zod')

const IntentClassificationSchema = z.object({
  primaryIntent: z.enum([
    'information_request',
    'price_inquiry',
    'purchase_intent',
    'dosage_usage_question',
    'health_condition_question',
    'product_composition_question',
    'delivery_or_availability_question',
    'payment_question',
    'proof_testimonial_request',
    'media_or_proof_request',
    'business_or_reseller_interest',
    'follow_up_or_deferral',
    'order_confirmation',
    'conversation_closing',
    'unknown'
  ]),
  secondaryIntents: z.array(z.enum([
    'information_request',
    'price_inquiry',
    'purchase_intent',
    'dosage_usage_question',
    'health_condition_question',
    'product_composition_question',
    'delivery_or_availability_question',
    'payment_question',
    'proof_testimonial_request',
    'media_or_proof_request',
    'business_or_reseller_interest',
    'follow_up_or_deferral',
    'order_confirmation',
    'conversation_closing',
    'unknown'
  ])).default([]),
  purchaseStage: z.enum([
    'none',
    'information',
    'quantity_needed',
    'ready_to_order',
    'quantity_selected',
    'order_confirmation',
    'delivery_pending',
    'payment_pending',
    'completed'
  ]),
  quantity: z.union([z.number().int().positive().max(99), z.null()]),
  deliveryLocation: z.union([z.string().max(120), z.null()]),
  paymentMode: z.union([
    z.enum([
      'cash_on_delivery',
      'mobile_money',
      'wave',
      'orange_money',
      'moov_money',
      'mtn_money',
      'card',
      'unknown'
    ]),
    z.null()
  ]),
  objectionType: z.union([
    z.enum([
      'price_high',
      'delay_or_follow_up',
      'spouse_or_relative',
      'delivery',
      'payment',
      'composition',
      'price_or_budget',
      'safety_or_medical',
      'availability',
      'trust_or_proof',
      'efficacy',
      'unknown'
    ]),
    z.null()
  ]),
  medicalConcern: z.boolean(),
  conversationClosed: z.boolean(),
  shouldNotifySales: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300)
})

const DEFAULT_CLASSIFICATION = {
  primaryIntent: 'unknown',
  secondaryIntents: [],
  purchaseStage: 'none',
  quantity: null,
  deliveryLocation: null,
  paymentMode: null,
  objectionType: null,
  medicalConcern: false,
  conversationClosed: false,
  shouldNotifySales: false,
  confidence: 0,
  reason: 'Classification unavailable.'
}

const ALLOWED_PRIMARY_INTENTS = new Set([
  'information_request',
  'price_inquiry',
  'purchase_intent',
  'dosage_usage_question',
  'health_condition_question',
  'product_composition_question',
  'delivery_or_availability_question',
  'payment_question',
  'proof_testimonial_request',
  'media_or_proof_request',
  'business_or_reseller_interest',
  'follow_up_or_deferral',
  'order_confirmation',
  'conversation_closing',
  'unknown'
])

const ALLOWED_PURCHASE_STAGES = new Set([
  'none',
  'information',
  'quantity_needed',
  'ready_to_order',
  'quantity_selected',
  'order_confirmation',
  'delivery_pending',
  'payment_pending',
  'completed'
])

const ALLOWED_PAYMENT_MODES = new Set([
  'cash_on_delivery',
  'mobile_money',
  'wave',
  'orange_money',
  'moov_money',
  'mtn_money',
  'card',
  'unknown'
])

const ALLOWED_OBJECTION_TYPES = new Set([
  'price_high',
  'delay_or_follow_up',
  'spouse_or_relative',
  'delivery',
  'payment',
  'composition',
  'price_or_budget',
  'safety_or_medical',
  'availability',
  'trust_or_proof',
  'efficacy',
  'unknown'
])

const normalizeText = (value = '') => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const parseSessionJson = (value, fallback = {}) => {
  if (!value) return fallback
  if (typeof value === 'object') return value

  try {
    return JSON.parse(value)
  } catch (_error) {
    return fallback
  }
}

const hasReadyToOrderSignal = (message = '') => {
  const value = normalizeText(message)
  if (hasDelayOrFollowUpSignal(message)) return false
  if (hasAntiHardSellQuestioningSignal(message)) return false
  return /\b(?:je\s+)?(?:veux|souhaite|voudrais|aimerais|vais)\s+(?:commander|acheter|prendre|passer\s+commande)\b/.test(value) ||
    /\b(?:comment|ou|où)\s+(?:commander|acheter|passer\s+commande)\b/.test(value) ||
    /\bcomment\s+avoir\s+(?:ca|ça|cela|ce\s+produit)\b/.test(value) ||
    hasPossessionPurchaseSignal(message) ||
    /\b(?:je\s+suis\s+)?interesse\s+par\s+(?:le\s+)?traitement\b/.test(value) ||
    /\b(?:je\s+)?(?:commande|achete|prends)\b/.test(value)
}

const hasPossessionPurchaseSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:comment\s+faire\s+pour\s+)?(?:entrer|rentrer)\s+en\s+possession\b/.test(value)
}

const hasQuantitySignal = (message = '') => {
  const value = normalizeText(message)
  if (hasExplicitBoxQuantityWithPackSignal(message)) return true
  if (hasDurationQuestionSignal(message)) return false
  if (hasAntiHardSellQuestioningSignal(message)) return false
  if (hasPackageContentSignal(message) || hasPriceInquirySignal(message)) return false
  if (hasPackClarificationSignal(message)) return false

  return /\b(?:je\s+)?(?:prends?|veux|souhaite|commande|achete|vais\s+commencer\s+avec|commencer\s+avec)\s+(?:\d+|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:boites?|boite|packs?|cures?)\b/.test(value) ||
    /\b(?:\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:boites?|boite|packs?|cures?)\s*(?:svp|s'il vous plait|stp)?\b/.test(value) ||
    /\b(?:prendre|commander|acheter)\s+(?:une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s+d['’ ]?abord\b/.test(value) ||
    /\b(?:pack\s+starter|pack\s+bronze)\b/.test(value)
}

const hasExplicitBoxQuantityWithPackSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:\d+|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:boites?|boite)\b.{0,60}\bpack\s+(?:starter|bronze)\b/.test(value) ||
    /\bpack\s+(?:starter|bronze)\b.{0,60}\b(?:\d+|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:boites?|boite)\b/.test(value)
}

const hasDurationQuestionSignal = (message = '') => {
  const value = normalizeText(message)
  return /\bcombien\s+de\s+(?:semaines?|jours?|mois|temps)\b/.test(value) ||
    /\b(?:boites?|boite|packs?|cures?)\s+(?:fait|dure|durent?)\s+combien\s+de\s+(?:semaines?|jours?|mois|temps)\b/.test(value)
}

const hasInformationRequestSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:en\s+savoir\s+plus|plus\s+d['’ ]?infos?|plus\s+d['’ ]?informations?|puis[-\s]?je\s+savoir|puisse\s+savoir|expliquez|explique|quel\s+est\s+le\s+produit|c['’ ]?est\s+quoi|c['’ ]?est\s+a\s+dire|qu['’ ]?est\s+ce\s+que|que\s+voulez\s+vous\s+dire|comment\s+vous\s+contacter|vous\s+faites?\s+quoi|donnez\s+moi\s+des\s+infos?)\b/.test(value)
}

const hasPackClarificationSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:c['’ ]?est|cest|c\s+est)?\s*(?:quoi|koi)\b.{0,40}\b(?:pack|packs)\b/.test(value) ||
    /\b(?:histoire|histoires)\s+de\s+packs?\b/.test(value)
}

const hasAntiHardSellQuestioningSignal = (message = '') => {
  const value = normalizeText(message)
  return /\bavant\s+de\s+(?:me\s+)?demander\s+si\s+je\s+veux\s+commander\b/.test(value) ||
    (/\b(?:d['’ ]?autres?|mes)\s+questions?\b/.test(value) && /\b(?:commander|commande|sante|cure)\b/.test(value)) ||
    (/\bsituation\s+de\s+sante\b/.test(value) && /\b(?:questions?|commander|commande|cure)\b/.test(value))
}

const hasGenericHowToProceedSignal = (message = '') => {
  const value = normalizeText(message)
  return /\bcomment\s+faire\b/.test(value) && !hasMedicalConcernSignal(message)
}

const hasBusinessOrResellerInterestSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:groupe\s+de\s+vente|groupe\s+vente|groupe\s+business|business|revendeur|revendeuse|revendre|distributeur|distributrice|distribution|plan\s+d['’ ]?affaire)\b/.test(value) &&
    (/\b(?:adherer|adhere|adhesion|integrer|rejoindre|entrer|inscrire|inscription|participer|partenaire|devenir)\b/.test(value) ||
      /\b(?:puis\s+je|peux\s+je|comment|possible)\b/.test(value))
}

const hasWhatsAppContactOnlySignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:avoir|avoi|donnez|donner|souhaite|veux|voudrais|peux\s+avoir|puis\s+avoir)\b.{0,40}\b(?:votre|ton|le)\s+(?:whatsapp|whats\s*app|numero\s+whatsapp|num\s+whatsapp)\b/.test(value) &&
    !/\b(?:partenaire|revendeur|revendeuse|revendre|business|groupe\s+de\s+vente|commande|commander|acheter|prendre)\b/.test(value)
}

const hasContextualBusinessPartnerFollowUpSignal = (message = '') => {
  const value = normalizeText(message)
  return /^(?:client\s+apres\s+revendeur|client\s+après\s+revendeur|partenaire|devenir\s+partenaire|revendeur|devenir\s+revendeur|des?\s+renseignements?|renseignements?)\.?$/.test(value) ||
    /\b(?:les\s+)?deux\s+cas\b.{0,40}\b(?:interesse|interessent|m'interesse|m'interessent)\b/.test(value) ||
    /\b(?:devenir|etre|être)\s+(?:partenaire|revendeur|revendeuse)\b/.test(value)
}

const hasExplicitBusinessPartnerHandoffSignal = (message = '') => {
  const value = normalizeText(message)
  return /^(?:partenaire|devenir\s+partenaire|revendeur|devenir\s+revendeur)\.?$/.test(value) ||
    /\b(?:devenir|etre|être)\s+(?:partenaire|revendeur|revendeuse)\b/.test(value)
}

const hasExternalPromotionSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:delivery|livraison\s+express|colis\s+a\s+livrer|repas\s+a\s+recevoir|courses\s+a\s+faire\s+livrer|commandes?\s+et\s+infos?)\b/.test(value) &&
    !/\b(?:miira|miira[-_\s]?cell|miracell|miiracell|revoobit)\b/.test(value)
}

const hasWrongTopicCorrectionSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:je\s+me\s+suis\s+trompee?|je\s+me\s+suis\s+trompe|excusez?\s+moi\s+je\s+me\s+suis\s+trompee?)\b/.test(value) ||
    /\b(?:je\s+parle|je\s+parlais)\s+(?:du|de|d['’ ]?un|d['’ ]?une)\s+(?:livre|document|pdf)\b/.test(value)
}

const hasPriceInquirySignal = (message = '') => {
  const value = normalizeText(message)
  if (hasDurationQuestionSignal(message)) return false
  if (hasPriceHighObjectionSignal(message)) return false

  return /\b(?:prix|tarif|cout|co[uû]t|montant|budget)\b/.test(value) ||
    /\b(?:c['’ ]?est|ca|ça)?\s*(?:une\s+)?boite\s+(?:qui\s+)?fait\s+\d{3,6}\b/.test(value) ||
    /\b(?:traitement|cure|pack|boite|produit)?\s*(?:coute|co[uû]te|fait)\s+combien\b/.test(value) ||
    /\b(?:c['’ ]?est|ca|ça|la\s+boite|une\s+boite|le\s+pack|ce\s+produits?|le\s+produit|miira[-_\s]?cl?l?\+?|miira[-_\s]?cell\+?)\s+.*(?:fait|coute|co[uû]te)\s+combien\b/.test(value) ||
    /\b(?:combien\s+(?:ca|ça|c['’ ]?est|coute|co[uû]te)|c['’ ]?est\s+combien)\b/.test(value) ||
    hasPaymentCalculationSignal(message)
}

const hasPriceHighObjectionSignal = (message = '') => {
  const value = normalizeText(message)
  if (/\b(?:2|deux)\s*boites?b?\s*(?:a|à|pour)?\s*86\s*k\b/.test(value)) return false
  if (/\b(?:1|un|une)\s*boites?b?\s*(?:a|à|pour)?\s*43\s*k\b/.test(value)) return false
  if (hasTreatmentBudgetConcernSignal(message)) return true
  return /\b(?:trop\s+cher|cher|chere|cout[eû]ux|exhorbitant|exorbitant|prix\s+eleve|c['’ ]?est\s+beaucoup|beaucoup|pas\s+les?\s+moyens|pas\s+mon\s+budget)\b/.test(value) ||
    /\b(?:diminuer|reduire|reduction|remise|rabais|baisser|moins\s+cher|dernier\s+prix)\b/.test(value) ||
    /\b(?:\d+|un|une|deux|trois)\s*boites?b?\s*(?:a|à|pour)?\s*\d{2,5}\s*k?\b/.test(value)
}

const hasTreatmentBudgetConcernSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:mine\s+de\s+rien|quand\s+meme|quand\s+memes?|ca\s+fait|cela\s+fait|fait)\b.{0,80}\b(?:43\s*000|43000|43\s*k|fcfa|f\s*cfa)\b/.test(value) ||
    /\b(?:1|un|une|la)\s*boites?\s*(?:fait|coute|co[uû]te|est\s+a)\s*(?:43\s*000|43000|43\s*k)\b/.test(value)
}

const hasPaymentCalculationSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:calcul|ne\s+comprends?\s+pas|n['’ ]?est\s+ce\s+pas)\b/.test(value) &&
    /\b(?:fcfa|f\s*cfa|sachets?|boites?|prix)\b/.test(value)
}

const hasDosageUsageSignal = (message = '') => {
  const value = normalizeText(message)
  if (hasPriceInquirySignal(message) && !/\bsachets?\b/.test(value)) return false
  if (hasDelayOrFollowUpSignal(message)) return false

  return (hasDurationQuestionSignal(message) ||
    /\b(?:prise|prendre|utilisation|utiliser|mode\s+d['’ ]?emploi|posologie|dosage|dose|duree|traitement|cure|effets?\s+apres\s+combien\s+de\s+temps|combien\s+de\s+temps|combien\s+de\s+semaines?|combien\s+de\s+boites?|combien\s+de\s+sachets?|il\s+en\s+faut\s+combien|combien\s+(?:il\s+)?en\s+faut|matin|soir|jeun|a\s+jeun|sachets?\s+par\s+jour|nombre\s+de\s+boites?|\d+\s+sachets?)\b/.test(value)) &&
    !hasReadyToOrderSignal(message)
}

const hasPackageContentSignal = (message = '') => {
  const value = normalizeText(message)
  if (/\b(?:une?|la)\s+boite\s+contient\s+combien\s+de\s+(?:comprimes?|comprimés?|tablettes?|gelules?|gélules?|capsules?)\b/.test(value)) return true
  if (/\bcombien\s+de\s+(?:comprimes?|comprimés?|tablettes?|gelules?|gélules?|capsules?)\s+(?:contient|dans)\s+(?:une?|la)\s+boite\b/.test(value)) return true
  return /\b(?:combien\s+de\s+sachets?\s+par\s+boite|sachets?\s+par\s+boite|contenu\s+de\s+la\s+boite|dans\s+la\s+boite)\b/.test(value) ||
    /\b(?:une?|la)\s+boite\s+contient\s+combien\s+de\s+sachets?\b/.test(value) ||
    /\b(?:elle|la\s+boite)\s+contient\s+combien\s+de\s+sachets?\b/.test(value) ||
    /\bcombien\s+de\s+sachets?\s+(?:contient|dans)\s+(?:une?|la)\s+boite\b/.test(value) ||
    /\b(?:ca|ça|sa)\s+fait\s+\d+\s*sache?t?s?\b/.test(value)
}

const hasHealthEfficacyQuantitySignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:une?|\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:boites?|boite|packs?|cures?)\b/.test(value) &&
    /\b(?:regle|regler|resout|resoudre|resolu|résout|résoudre|résolu)\s+(?:pas\s+)?(?:le|la|mon|ma|mes)?\s*problemes?\b/.test(value)
}

const hasTreatmentQuantityQuestionSignal = (message = '') => {
  const value = normalizeText(message)
  // Doit etre une vraie question sur le nombre de boites necessaires (besoin),
  // pas une simple mention de "boite" ni une intention d'achat ("commencer avec une boite").
  return /\bcombien\s+de\s+(?:boites?|boite|paquets?|packs?)\b/.test(value) ||
    /\bil\s+(?:(?:m['’ ]?)?en\s+)?faut\s+combien\b/.test(value) ||
    /\bcombien\s+(?:il\s+)?(?:(?:m['’ ]?)?en\s+)?faut\b/.test(value) ||
    /\b(?:boites?|boite|paquets?|packs?)\s+(?:me\s+)?faut[- ]?il\b/.test(value) ||
    /\b(?:me\s+)?faut[- ]?il\b.{0,40}\b(?:boites?|boite|paquets?|packs?|cure|traitement)\b/.test(value)
}

const hasHighBoxCountTreatmentQuestionSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:faut|falloir|necessaire|oblige|obligatoire|forcement)\b.{0,80}\b(?:\d{1,2}\s*[-a]\s*\d{1,2}|10\s*(?:a|-)\s*20)\s*boites?\b/.test(value) &&
    /\b(?:traitement|cure|traiter|soigner|guerir)\b/.test(value)
}

const hasTreatmentNormalQuantityQuestionSignal = (message = '') => {
  const value = normalizeText(message)
  return /\btraitement\s+(?:normal|complet)\b/.test(value) &&
    /\b(?:combien|boites?|boite|paquets?|packs?|il\s+faut|faut)\b/.test(value) &&
    !/\bguerison\s+(?:totale|complete)\b/.test(value)
}

const hasMedicalConcernSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:diabete|diabetique|glycemie|insuline|hypertension|hypertendu|tension|prostate|prostatite|urinaire|sonde|catheter|cath[eé]ter|glaucome|cancer|vih|sida|mal\s+de\s+sang|drepanocytose|maladie|malade|pathologie|pathologies|renal|renale|rein|reins|pancreas|pancrea|pencrea|ulcere|buruli|myomes?|fibromes?|medicament|medicaments|preventif|prevention|certain\s+age|grossesse|enceinte|allaitement|allaitante|effets?\s+secondaires?|contres?[-\s]?indications?|danger|risque|medecin|medecins|avis\s+medical|hopital)\b/.test(value) ||
    /\b(?:sous|avec|mon|mes|un)\s+traitements?\s+(?:medical|medicaux|en\s+cours)\b/.test(value) ||
    /\b(?:poids|surpoids|obesite|maigrir|amaigrir|minceur|graisses?|bruler\s+les\s+graisses?|brule\s+graisse|perdre\s+\d+\s*(?:kg|kilos?))\b/.test(value) ||
    /\b(?:regle|regler|resout|resoudre|resolu|résout|résoudre|résolu)\s+(?:pas\s+)?(?:le|la|mon|ma|mes)?\s*problemes?\b/.test(value) ||
    /\b(?:pour\s+)?guerir\b/.test(value) ||
    /\b(?:soigner|soigne|traiter|guerir|gueri|guerit|gu[eé]rir|gu[eé]rit|finir)\s+(?:le|la|les|mon|ma|mes)?\s*(?:diabete|tension|hypertension|maladie|pathologie|pathologies|myomes?|fibromes?)\b/.test(value) ||
    /\b(?:qu['’ ]?est\s+ce\s+que\s+)?(?:ca|ça|cela|ce\s+produits?|le\s+produit|le\s+pack|ce\s+pack|ce\s+pacte|miira[-\s]?cell\+?)\s+(?:soigne|guerit|gueri|gu[eé]rit)\b/.test(value) ||
    /\b(?:soigne|guerit|gueri|gu[eé]rit)\s+(?:quoi|quelles?\s+maladies?)\b/.test(value) ||
    /\bne\s+(?:se|ce)\s+(?:guerit|gueri|gu[eé]rit)\s+pas\b/.test(value) ||
    /\b(?:disparaitre|disparait|dispara[iî]tre|dispara[iî]t)\b/.test(value) ||
    /\b(?:ca|ça|cela|ce\s+produit|miira[-\s]?cell\+?)\s+peut\s+(?:m['’ ]?)?aider\b/.test(value) ||
    /\bguerison\s+(?:totale|complete)\b/.test(value) ||
    /\btraitement\s+(?:normal|complet)\b/.test(value)
}

const hasDeferralDominantSignal = (message = '') => {
  const value = normalizeText(message)
  return hasDelayOrFollowUpSignal(message) &&
    (/\b(?:commande|commander|achat|acheter|argent|budget|moyens|fonds|fin\s+du\s+mois|salaire|enfants?|famille)\b/.test(value) ||
      hasPriceInquirySignal(message) ||
      hasReadyToOrderSignal(message))
}

const hasGuineaFlagSignal = (message = '') => {
  const rawValue = String(message || '')
  return rawValue.includes('🇬🇳') || rawValue.includes('ðŸ‡¬ðŸ‡³')
}

const hasSentMessagesReviewSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:laiss(?:e|ez|er)|donne[rz]?|accorde[rz]?)(?:\s|-)+(?:moi|nous)\s+(?:le\s+)?temps\s+de\s+(?:lire|ecouter|consulter|voir|prendre\s+connaissance)\b.{0,80}\b(?:messages?|audios?|documents?|supports?|infos?|informations?)\s+envoy(?:e|es|ees)\b/.test(value) ||
    /\b(?:laiss(?:e|ez|er)|donne[rz]?|accorde[rz]?)(?:\s|-)+(?:moi|nous)\s+(?:prendre\s+connaissance|lire|ecouter|consulter|voir)\b.{0,80}\b(?:messages?|audios?|documents?|supports?|infos?|informations?)\s+envoy(?:e|es|ees)\b/.test(value) ||
    /\b(?:je\s+vais|je\s+veux|je\s+voudrais|je\s+souhaite)\s+(?:d['’ ]?abord\s+)?(?:lire|ecouter|consulter|voir|prendre\s+connaissance)\b.{0,80}\b(?:messages?|audios?|documents?|supports?|infos?|informations?)\s+envoy(?:e|es|ees)\b/.test(value) ||
    /\b(?:je\s+vais|je\s+veux|je\s+voudrais|je\s+souhaite)\s+(?:d['’ ]?abord\s+)?(?:prendre\s+connaissance|lire|ecouter|consulter|voir)\b/.test(value)
}

const hasDelayOrFollowUpSignal = (message = '') => {
  const value = normalizeText(message)
  if (hasOrderLogisticsFollowUpSignal(message)) return true
  if (hasSentMessagesReviewSignal(message)) return true
  if (/\bpas\s+si\s+vite\b/.test(value)) return true
  if (/\b(?:pas|plus)\s+(?:en\s+)?possession\s+de\s+l['’ ]?argent\b/.test(value)) return true
  if (/\b(?:discuter|parler|voir)\s+avec\s+(?:mes|nos|mon|ma|m[a-z]+)\s+(?:enfants?|epoux|epouse|mari|femme|famille)\b/.test(value)) return true
  if (/\b(?:donnez|donner|donne|donniez)\s+(?:moi|nous)\s+(?:un\s+)?(?:contact|numero|telephone|representant)\b/.test(value) &&
    /\b(?:quand|lorsque|si).{0,40}(?:serai|suis|pret|prete|prêt|prête|decide|deciderai|besoin|moment)\b/.test(value)) return true
  if (/\b(?:contact|numero|telephone|representant)\b/.test(value) &&
    /\b(?:je\s+)?(?:vais|veux|voudrais|souhaite)\s+(?:appeler|contacter|rappeler)\b/.test(value) &&
    /\b(?:quand|lorsque|si|plus\s+tard|pret|prete|prêt|prête)\b/.test(value)) return true
  if (/\b(?:des|d.s|quand|lorsque).{0,30}(?:reunis?|rassemblerai|aurai|trouverai).{0,30}(?:les\s+)?(?:moyens|fonds|argent|budget)\b/.test(value)) return true
  if (/\b(?:des|d.s|quand|lorsque).{0,30}(?:reunis?|r[eÃ©]unis?|rassemblerai|aurai|trouverai).{0,30}(?:les\s+)?(?:moyens|fonds|l['â€™ ]?argent|argent|budget)\b/.test(value)) return true
  return /\b(?:je\s+(?:vous\s+)?reviens|je\s+reviens\s+vers\s+vous|je\s+vais\s+revenir|je\s+(?:vous\s+)?reviendrai|je\s+(?:vous\s+)?reviendrais|je\s+vous\s+rappelle|je\s+vous\s+(?:re)?contacte|je\s+vous\s+fais\s+signe)\b/.test(value) ||
    /\brevenir\s+(?:des|dès)\s+que\s+je\s+serai\s+pret\b/.test(value) ||
    /\b(?:a\s+)?(?:tres\s+)?bientot\b/.test(value) ||
    /\bincessamment\b/.test(value) ||
    /\bje\s+vais\s+presenter\s+a\s+quelqu['’ ]?un\b/.test(value) ||
    /\b(?:reunir|rassembler|chercher)\s+(?:les\s+)?(?:moyens|fonds|l['’ ]?argent|argent)\b/.test(value) ||
    /\b(?:selon|suivant)\s+(?:mes|nos)\s+moyens\b/.test(value) ||
    /\b(?:je\s+)?(?:veux|voudrais|souhaite|vais)\s+(?:vous\s+)?appeler\s+(?:demain|plus\s+tard)\b/.test(value) ||
    /\b(?:j['’ ]?aviserai|je\s+vais\s+aviser|j['’ ]?avise)\s+(?:le\s+)?moment\s+venu\b/.test(value) ||
    /\b(?:ah\s*ok\s+merci|ahok\s+merci|ok\s+merci|ok\s+j['’ ]?ai\s+compris|merci|je\s+vais\s+reflechir|je\s+vais\s+voir|je\s+garde\s+votre\s+contact|plus\s+tard|pas\s+maintenant|pour\s+le\s+moment\s+non|fin\s+(?:du|de)\s+mois|apres\s+salaire|moment\s+opportun)\b/.test(value) ||
    /^(?:ok|non)$/i.test(value)
}

const hasConversationClosingSignal = (message = '') => {
  const value = normalizeText(message)
  return /^(?:a\s+bientot|à\s+bientot|au\s+revoir|bonne\s+journee|bonne\s+soiree|salut)\s*!?\.?$/.test(value) ||
    /^(?:merci\s+)?(?:bne|bnne|bonne)\s+journee\s*!?\.?$/.test(value) ||
    /^merci\s+(?:bne|bnne|bonne)\s+journee\s*!?\.?$/.test(value) ||
    /^(?:d['’ ]?accord\s+)?merci\s*!?\.?$/.test(value) ||
    /\bmerci\s+pour\s+(?:tous\s+)?(?:les\s+)?(?:renseignements|informations|infos|explications)\b/.test(value)
}

const hasProductCompositionSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:ingredients?|composition|compose|contenu|contient|naturel|nature|parlez\s+moi\s+du\s+produit|13\s+ingredients?)\b/.test(value) ||
    /\b(?:c['’ ]?est\s+quoi|qu['’ ]?est\s+ce\s+que)\s+(?:ce\s+)?produits?\b/.test(value)
}

const hasProductAndIngredientsSignal = (message = '') => {
  const value = normalizeText(message)
  return /\bproduit\b/.test(value) && /\bingredients?\b/.test(value)
}

const hasQuestionReminderSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:repondez|reponds?|repondre)\s+(?:a\s+)?(?:mes|ma|mon|aux?)\s+questions?\b/.test(value) ||
    /\b(?:vous\s+)?ne\s+(?:me\s+)?repondez\s+pas\s+a\s+(?:mes|ma|mon|aux?)\s+questions?\b/.test(value) ||
    /\b(?:vous\s+)?ne\s+(?:me\s+)?repondez\s+(?:toujours\s+)?pas\s+a\s+(?:mes|ma|mon|aux?)\s+questions?\b/.test(value) ||
    /\b(?:vous\s+)?ne\s+(?:me\s+)?repondez\s+(?:toujours\s+)?pas\s+a\s+(?:ma|mon|la)\s+question\b/.test(value) ||
    /\bma\s+question\b/.test(value) ||
    /\b(?:repondez|reponds?|repondre)\s+(?:a\s+)?(?:mon|ce|le)\s+message\b/.test(value) ||
    /\barretez\s+de\s+m['’ ]?envoyer\s+les\s+memes\s+messages\b/.test(value) ||
    /\b(?:j['’ ]?attends|attends)\s+(?:votre|ta)\s+reponse\b/.test(value)
}

const hasAlreadyAnsweredSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:je\s+vous\s+ai|j['’ ]?ai)\s+deja\s+repond(?:u|ue)\b/.test(value) ||
    /\bdeja\s+repond(?:u|ue)\b/.test(value)
}

const hasAiSuspicionSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:ia|intelligence\s+artificielle|robot|bot|automate)\b/.test(value)
}

const hasOrderConfirmationSignal = (message = '', conversation = []) => {
  const value = normalizeText(message)
  const recentMessages = Array.isArray(conversation) ? conversation : []
  const recentContext = normalizeText(recentMessages.slice(-4).map((item) => item.message || '').join(' '))
  const lastOutboundContext = normalizeText([...recentMessages].reverse().find((item) => item.direction === 'outbound')?.message || '')
  const strongConfirmation = /\b(?:je\s+)?(?:valide|confirme|confirmer|validation|ok\s+je\s+confirme)\b/.test(value)
  const shortAffirmation = /^(?:oui|ok|okay|daccord|d accord|c est bon|cest bon)[.!?]*$/.test(value)
  const orderValidationContext = /\b(?:valider|confirmer|commande|vous\s+souhaitez\s+valider)\b/

  return (strongConfirmation && orderValidationContext.test(recentContext)) ||
    (shortAffirmation && orderValidationContext.test(lastOutboundContext))
}

const hasSimpleAffirmationSignal = (message = '') => {
  const value = normalizeText(message)
  return /^(?:oui|ok|okay|daccord|d accord|c est bon|cest bon|bien sur|volontiers)[.!?]*$/.test(value)
}

const hasRecentMediaOrProofOffer = (conversation = []) => {
  const recentContext = normalizeText((Array.isArray(conversation) ? conversation : [])
    .slice(-4)
    .map((item) => item.message || '')
    .join(' '))

  return /\b(?:visuels?|images?|photos?|videos?|temoignages?|preuves?|supports?)\b/.test(recentContext) &&
    /\b(?:souhaitez|voulez|peux|possible|envoyer|orienter|partager)\b/.test(recentContext)
}

const extractBoxQuantity = (message = '') => {
  const value = normalizeText(message)
  const wordQuantities = {
    un: 1,
    une: 1,
    deux: 2,
    trois: 3,
    quatre: 4,
    cinq: 5,
    six: 6,
    sept: 7,
    huit: 8,
    neuf: 9,
    dix: 10
  }
  const numericMatch = value.match(/\b(\d{1,2})\s*(?:boites?|boite|packs?|cures?)\b/)
  if (numericMatch) return Number(numericMatch[1])

  const wordMatch = value.match(/\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:boites?|boite|packs?|cures?)\b/)
  if (wordMatch) return wordQuantities[wordMatch[1]] || null

  const implicitBoxChoiceMatch = value.match(/\b(?:prendre|commander|acheter)\s+(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s+d['’ ]?abord\b/)
  if (implicitBoxChoiceMatch) return wordQuantities[implicitBoxChoiceMatch[1]] || null

  if (/\bpack\s+starter\b/.test(value)) return 1
  if (/\bpack\s+bronze\b/.test(value)) return 2
  return null
}

const extractDeliveryLocation = (message = '') => {
  const rawMessage = String(message || '').trim()
  const value = normalizeText(message)
  if (!/[?]/.test(rawMessage) &&
    rawMessage.length >= 12 &&
    /\b(?:abidjan|yopougon|cocody|plateau|libreville|port[-\s]?gentil)\b/.test(value) &&
    !/\b(?:combien|prix|payer|paiement|mobile money|wave|orange money|moov|mtn|visa|boites?|sachets?)\b/.test(value)) {
    return rawMessage.replace(/[.!?]+$/, '').trim()
  }

  const residenceMatch = value.match(/\b(?:je\s+)?(?:reside|habite|suis)\s+(?:a|au|dans|en)\s+(.{3,90})$/)
  if (residenceMatch?.[1]) {
    const candidate = residenceMatch[1]
      .replace(/\b(?:pour|afin|concernant)\b.*$/i, '')
      .replace(/[.!?]+$/, '')
      .trim()
    if (candidate && !/\b(?:livraison|certainement|cet\s+effet|paiement|payement|mobile\s+money|wave|cash|bientot|incessamment|interesse|interessee|reveni?r|reviendrai)\b/.test(candidate)) {
      return candidate
        .replace(/\babidjan\b/i, 'Abidjan')
        .replace(/\byopougon\b/i, 'Yopougon')
        .replace(/\bcocody\b/i, 'Cocody')
    }
  }
  if (hasGuineaFlagSignal(message) || /\bguinee\b/.test(value)) return 'Guinee'
  if ((/\bcote\s+d[’']?\s*ivoire\b/.test(value) || /\bcote\s+divoire\b/.test(value)) && /\babidjan\b/.test(value)) return "Cote d'Ivoire Abidjan"
  if (/\bcote\s+d[’']?\s*ivoire\b/.test(value) || /\bcote\s+divoire\b/.test(value)) return "Cote d'Ivoire"
  if (/\bci\b/.test(value)) return 'CI'
  const detailedPlateauMatch = value.match(/\b(?:au\s+)?(plateau(?:\s+rue\s+des\s+banques)?(?:\s+immeuble\s+[a-z0-9]+)?)\b/)
  if (detailedPlateauMatch) return detailedPlateauMatch[1].replace(/^au\s+/, '')
  const locations = [
    ['port-gentil', 'Port-Gentil'],
    ['port gentil', 'Port-Gentil'],
    ['libreville au gabon', 'Libreville au Gabon'],
    ['libreville', 'Libreville'],
    ['abidjan yopougon', 'Abidjan Yopougon'],
    ['abidjan cocody', 'Abidjan Cocody'],
    ['cote d ivoire', "Cote d'Ivoire"],
    ['cote divoire', "Cote d'Ivoire"],
    ["cote d'ivoire", "Cote d'Ivoire"],
    ['guinee', 'Guinee'],
    ['plateau', 'Plateau'],
    ['abidjan', 'Abidjan'],
    ['yopougon', 'Yopougon'],
    ['cocody', 'Cocody'],
    ['bouake', 'Bouaké'],
    ['gabon', 'Gabon']
  ]

  const match = locations.find(([normalizedLocation]) => value.includes(normalizedLocation))
  return match ? match[1] : null
}

const selectDeliveryLocation = (...values) => {
  return values
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .sort((left, right) => String(right).length - String(left).length)[0] || null
}

const extractPaymentMode = (message = '') => {
  const value = normalizeText(message)
  if (/\bwave\b/.test(value)) return 'wave'
  if (/\borange\s+money\b/.test(value)) return 'orange_money'
  if (/\bmoov\s+money\b/.test(value)) return 'moov_money'
  if (/\bmtn\s+money\b/.test(value)) return 'mtn_money'
  if (/\b(?:mobile\s+money|momo)\b/.test(value)) return 'mobile_money'
  if (/\b(?:visa|carte|card)\b/.test(value)) return 'card'
  if (/\b(?:cash|especes|espÃ¨ces|paiement|payement|payer|paie)\s+a\s+la\s+livraison\b/.test(value) ||
    /\ba\s+la\s+livraison\b/.test(value) ||
    /\b(?:cash|especes|espÃ¨ces)\b/.test(value)) return 'cash_on_delivery'
  return null
}

const hasBusinessLocationQuestionSignal = (message = '') => {
  const value = normalizeText(message)
  return /\bvous\s+ou\b.{0,30}\bdans\s+quelle\s+ville\b/.test(value) ||
    /\bvous\s+(?:etes\s+ou|etes\s+situes?)\b/.test(value) ||
    /\bvous\s+etes\s+(?:bases?|basees?|situes?|situees?|localises?|localisees?|implantes?|implantees?)\s+(?:ou|dans\s+quelle\s+ville)\b/.test(value) ||
    /\b(?:vous|entreprise|boutique|bureau|agence|siege)\b.{0,40}\bdans\s+quelle\s+ville\b/.test(value) ||
    /\bdans\s+quelle\s+ville\b.{0,40}\b(?:vous|entreprise|boutique|bureau|agence|siege)\b/.test(value) ||
    /\bou\s+etes[-\s]+vous(?:\s+(?:bases?|basees?|situes?|situees?|localises?|localisees?|implantes?|implantees?))?\b/.test(value)
}

const hasRepresentativeContactRequestSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:contact|numero|telephone|tel|no|num)\b.{0,60}\brepresentants?\b/.test(value) ||
    /\brepresentants?\b.{0,60}\b(?:contact|numero|telephone|tel|no|num)\b/.test(value)
}

const hasRepresentativeAvailabilityQuestionSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:represente|representes|representation|representants?)\b/.test(value) &&
    !hasRepresentativeContactRequestSignal(message)
}

const hasDeliveryOrAvailabilitySignal = (message = '') => {
  const value = normalizeText(message)
  if (hasDelayOrFollowUpSignal(message) && /\b(?:contact|numero|telephone|representant)\b/.test(value)) return false
  return hasBusinessLocationQuestionSignal(message) ||
    hasGuineaFlagSignal(message) ||
    /\b(?:livraison|livrer|livrez|livre|frais\s+de\s+livraison|delai\s+de\s+livraison|disponible|disponibilite|stock|rupture|representants?|représentants?|vous\s+etes\s+situes?|ou\s+etes\s+vous|où\s+etes\s+vous|ou\s+pouvons\s+nous\s+l['’ ]?avoir|où\s+pouvons\s+nous\s+l['’ ]?avoir|ou\s+l['’ ]?avoir|où\s+l['’ ]?avoir|ou\s+le\s+trouver|où\s+le\s+trouver|trouver\s+ce\s+produit|s['’ ]?en\s+procurer|abidjan|plateau|yopougon|cocody|bouake|libreville|gabon|guinee|cote\s+d\W*ivoire|ci|commune|quartier|adresse|coordonnees?|contact)\b/.test(value)
}

const hasDeliveryFollowUpSignal = (message = '') => {
  const value = normalizeText(message)
  return hasOrderLogisticsFollowUpSignal(message) ||
    /\b(?:j['’ ]?attends|attends)\s+(?:ma|la|votre)?\s*commande\b/.test(value) ||
    /\b(?:deja|déjà)\s+commande\b/.test(value) ||
    /\bpromis\s+la\s+livraison\b/.test(value) ||
    /\blivraison\s+avant\s+\d{1,2}\s*h\b/.test(value)
}

const hasOrderLogisticsFollowUpSignal = (message = '') => {
  const value = normalizeText(message)
  return /\bj['’ ]?ai\s+deja\s+command(?:e|ee|er)?\b/.test(value) ||
    /\bdeja\s+command(?:e|ee|er)?\s+(?:\d+|une?|deux|trois)?\s*(?:boites?|boite)?\b/.test(value) ||
    /\bpromis\s+(?:la\s+)?livraison\s+avant\s+\d{1,2}\s*h\b/.test(value) ||
    /\b(?:j['’ ]?attends|attends)\s+(?:ma|la|votre)?\s*commande\b/.test(value)
}

const hasDeliveryDetailsSignal = (message = '') => {
  const value = normalizeText(message)
  if (hasDelayOrFollowUpSignal(message) && /\b(?:contact|numero|telephone|representant)\b/.test(value)) return false
  if (hasRepresentativeAvailabilityQuestionSignal(message)) return false
  if (extractDeliveryLocation(message) && /\b(?:possibilite|possible|disponible|disponibilite|presents?|avoir|obtenir|trouver)\b/.test(value)) return false
  return Boolean(extractDeliveryLocation(message)) ||
    /\b(?:coordonnees?|adresse|contact|telephone|numero)\b/.test(value) ||
    /\b(?:je\s+suis|je\s+serai|jusqu['’ ]?a|jusqu a)\s+.{0,40}\b(?:plateau|abidjan|yopougon|cocody|bouake|libreville)\b/.test(value)
}

const hasDeliveryHowToProceedSignal = (message = '') => {
  const value = normalizeText(message)
  return hasDeliveryOrAvailabilitySignal(message) && /\bcomment\s+faire\b/.test(value)
}

const hasPaymentSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:paiement|payement|payer|paie|payez|paye|wave|orange\s+money|moov\s+money|mtn\s+money|mobile\s+money|momo|visa|carte|lien\s+de\s+paiement|cash)\b/.test(value) ||
    /\b(?:paiement|payement|payer|paie)\s+a\s+la\s+livraison\b/.test(value) ||
    /\ba\s+la\s+livraison\b/.test(value)
}

const hasProofTestimonialSignal = (message = '') => {
  const value = normalizeText(message)
  if (hasInappropriateAdultContentSignal(message)) return false
  return /\b(?:preuve|preuves|temoignage|temoignages|video|videos|image|images|visuel|visuels|avis|resultats?|avant\s+apres|montrez|envoyez.*(?:video|image|visuel|temoignage|preuve)|j['’ ]?attends?.*(?:image|visuel|video)|garantie|efficacite|innocuite|brevet|certification|certifie|certifiee)\b/.test(value)
}

const hasInappropriateAdultContentSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:porno|pornographique|sexe|sexuel|sexuelle|nude|nu|nue|nues|xxx)\b/.test(value)
}

const hasLowInformationGreetingSignal = (message = '') => {
  const value = normalizeText(message)
  return /^(?:cc|coucou|bjr|bsr|bonjour|bonsoir|slt|hello|hi)(?:\s+(?:mr|mme|monsieur|madame|docteur|doc|chef|patron))?\s*[!.?]*$/.test(value)
}

const hasPersonalContextOnlySignal = (message = '') => {
  const value = normalizeText(message)
  return /\bje\s+suis\s+un\s+militaire\s+a\s+la\s+retraite\b/.test(value) &&
    !hasMedicalConcernSignal(message) &&
    !hasPriceInquirySignal(message) &&
    !hasReadyToOrderSignal(message)
}

const hasUnclearSocialMessageSignal = (message = '') => {
  const value = normalizeText(message)
  return /\bavec\s+moi\s+et\s+toi\s+tu\s+fais\b/.test(value)
}

const hasSafetyProofSignal = (message = '') => {
  const value = normalizeText(message)
  return /\b(?:garantie|garanti|efficacite|innocuite|brevet|certification|certifie|certifiee|notre\s+vie|ma\s+vie|risque|sans\s+risque)\b/.test(value)
}

const isStandaloneUrl = (message = '') => {
  return /^https?:\/\/\S+$/i.test(String(message || '').trim())
}

const buildSecondaryIntents = (message = '', primaryIntent = 'unknown') => {
  const hasHealthEfficacyQuantity = hasHealthEfficacyQuantitySignal(message)
  const paymentAtDeliveryOnly = /\ba\s+la\s+livraison\b/.test(normalizeText(message)) && primaryIntent === 'payment_question'
  const candidates = [
    ['information_request', hasInformationRequestSignal(message)],
    ['price_inquiry', hasPriceInquirySignal(message)],
    ['purchase_intent', !hasHealthEfficacyQuantity && (hasReadyToOrderSignal(message) || hasQuantitySignal(message) || hasDeliveryHowToProceedSignal(message) || hasGenericHowToProceedSignal(message))],
    ['dosage_usage_question', hasDosageUsageSignal(message) || hasHealthEfficacyQuantity],
    ['health_condition_question', hasMedicalConcernSignal(message)],
    ['product_composition_question', hasProductCompositionSignal(message) || hasPackageContentSignal(message)],
    ['delivery_or_availability_question', !paymentAtDeliveryOnly && (hasDeliveryOrAvailabilitySignal(message) || hasDeliveryDetailsSignal(message) || hasDeliveryFollowUpSignal(message))],
    ['payment_question', hasPaymentSignal(message)],
    ['proof_testimonial_request', hasProofTestimonialSignal(message)],
    ['business_or_reseller_interest', hasBusinessOrResellerInterestSignal(message)],
    ['follow_up_or_deferral', hasDelayOrFollowUpSignal(message)],
    ['conversation_closing', hasConversationClosingSignal(message)],
    ['information_request', hasQuestionReminderSignal(message)]
  ]

  return candidates
    .filter(([intent, detected]) => detected && intent !== primaryIntent)
    .map(([intent]) => intent)
    .filter((intent, index, intents) => intents.indexOf(intent) === index)
}

const compactConversation = (conversation = []) => {
  if (!Array.isArray(conversation)) return []

  return conversation.slice(-8).map((message) => ({
    direction: message.direction,
    message: String(message.message || '').slice(0, 800),
    sessionVariables: {
      orderConfirmed: message.sessionVariables?.orderConfirmed,
      conversationClosed: message.sessionVariables?.conversationClosed,
      handledObjections: message.sessionVariables?.handledObjections
    }
  }))
}

const buildClassificationPrompt = ({ recipient = {}, conversation = [], sessionVariables = {}, useCase = {} }) => {
  return `Tu es un agent Strands de classification conversationnelle pour Miira-Cell+.
Ta mission est d'analyser le dernier message prospect et le contexte recent, puis de retourner uniquement un JSON valide.

Contraintes importantes:
- Ne reponds jamais au prospect.
- Ne declenche aucune action.
- Ne fais aucune promesse medicale.
- "Je veux en savoir plus", "plus d'informations", "expliquez-moi" ou "c'est quoi le produit" sont des demandes d'information: primaryIntent = "information_request" et purchaseStage = "information".
- Les questions de prix comme "c'est combien", "le prix svp", "combien coute la boite" sont: primaryIntent = "price_inquiry", purchaseStage = "none".
- "Je veux commander", "je souhaite commander", "je veux acheter", "je veux prendre" ou "je vais commander" sont des intentions d'achat sans quantite: primaryIntent = "purchase_intent", purchaseStage = "quantity_needed", quantity = null, shouldNotifySales = false.
- "comment commander" ou "comment acheter" sont des intentions d'achat/procedure fortes: primaryIntent = "purchase_intent", purchaseStage = "ready_to_order", quantity = null, shouldNotifySales = true.
- "Comment faire pour entrer en possession" est une intention d'achat/procedure forte: primaryIntent = "purchase_intent", purchaseStage = "ready_to_order", shouldNotifySales = true.
- "Je suis interesse par le traitement" indique un interet d'achat fort: primaryIntent = "purchase_intent", purchaseStage = "ready_to_order", quantity = null, shouldNotifySales = true.
- Si le prospect donne une quantite de boites, par exemple "1 boite", "une boite", "2 boites", "5 boites", "pack starter" ou "pack bronze": purchaseStage = "quantity_selected", quantity = nombre de boites et shouldNotifySales = true.
- Exception stricte: si cette quantite apparait dans une question de necessite ou de traitement, par exemple "faut-il 10-20 boites pour un traitement", ce n'est pas une commande: primaryIntent = "dosage_usage_question", purchaseStage = "none", quantity = null, medicalConcern = true, shouldNotifySales = false.
- Une quantite de sachets comme "5 sachets" n'est pas une commande de boites: classe plutot en question d'usage/dosage si le message ne precise pas "boite".
- Les questions de prise, posologie, mode d'emploi, duree, dosage ou nombre de boites pour une cure sont: primaryIntent = "dosage_usage_question", purchaseStage = "none".
- Les questions de delai d'effet comme "effet apres combien de temps" sont des questions d'usage/duree: primaryIntent = "dosage_usage_question".
- Les formulations comme "il en faut combien", "combien il en faut" ou "il en faut combien pour une cure" sont des questions de dosage/quantite necessaire pour une cure: primaryIntent = "dosage_usage_question".
- Les questions de contenu de boite comme "combien de sachets par boite" sont: primaryIntent = "product_composition_question", purchaseStage = "none".
- Si le prospect mentionne une condition medicale ou un risque, par exemple "je suis diabetique", "prostate", "prostatite", "sonde urinaire", "catheter", "glaucome", "cancer", "VIH/sida", "mal de sang", "je suis hypertendu", "je suis enceinte", "je prends des medicaments", "effets secondaires" ou "contre-indications": primaryIntent = "health_condition_question", purchaseStage = "none", medicalConcern = true, shouldNotifySales = false.
- Les mentions de pancreas/pancrea/pencrea avec une maladie comme le diabete sont sensibles medicalement: primaryIntent = "health_condition_question", medicalConcern = true, shouldNotifySales = false.
- Les questions d'usage preventif, d'age ou de prise d'un medicament, par exemple "peut-on prendre ce medicament a titre preventif lorsqu'on a atteint un certain age", sont sensibles medicalement: primaryIntent = "health_condition_question", medicalConcern = true, shouldNotifySales = false.
- Les questions "ca soigne quoi", "qu'est-ce que ca soigne", "guerit quoi" ou "ca guerit quoi" sont sensibles medicalement: primaryIntent = "health_condition_question", medicalConcern = true, shouldNotifySales = false.
- Les formulations d'efficacite sur un probleme de sante comme "une boite ne regle pas le probleme" ou "avec 2 boites je regle mon probleme de diabete" sont sensibles medicalement: primaryIntent = "health_condition_question", medicalConcern = true, shouldNotifySales = false.
- Les demandes liees a la perte de poids comme "je veux perdre 25kg", "comment faire pour perdre 25kg", "maigrir", "surpoids" ou "mon poids me derange" sont sensibles sante: primaryIntent = "health_condition_question", medicalConcern = true, shouldNotifySales = false.
- Les titres ou appellations polis comme "docteur", "doc", "monsieur", "madame", "chef" ou "patron" ne sont pas des signaux medicaux seuls. Exemple: "Ok je vous reviens docteur" reste une temporisation: primaryIntent = "follow_up_or_deferral", medicalConcern = false.
- Les questions de composition, ingredients, nature du produit ou "parlez-moi du produit" sont: primaryIntent = "product_composition_question", purchaseStage = "none".
- Pour les messages multi-intentions, renseigne secondaryIntents avec les autres intentions detectees. Exemple: "Parlez-moi du produit, ingredients, posologie" => primaryIntent = "product_composition_question", secondaryIntents contient "dosage_usage_question".
- Les questions de livraison, lieu, disponibilite, stock, localisation, ville, commune ou quartier sont: primaryIntent = "delivery_or_availability_question", purchaseStage = "delivery_pending" si une livraison est en cours, sinon "none".
- Les questions generales comme "Vous faites des livraisons ?", "faites-vous des livraisons ?" ou "vous livrez ?" sont de simples questions logistiques: primaryIntent = "delivery_or_availability_question", purchaseStage = "none", shouldNotifySales = false.
- Les messages de presence ou localisation comme "vous etes presents au Gabon ?" ou "moi je suis au Gabon" sont des questions de disponibilite/livraison: primaryIntent = "delivery_or_availability_question".
- Les messages comme "je suis au Gabon comment faire" sont surtout des questions de procedure/disponibilite depuis un lieu: primaryIntent = "delivery_or_availability_question", secondaryIntents contient "purchase_intent".
- Les localisations comme "Libreville au Gabon" doivent renseigner deliveryLocation si detectees.
- Les messages qui donnent une adresse ou des coordonnees de livraison, par exemple "au plateau rue des banques immeuble SMGL, Contact 01 02 82 84 90", sont des informations de livraison: primaryIntent = "delivery_or_availability_question", purchaseStage = "delivery_pending", deliveryLocation doit contenir le lieu detecte.
- Si le prospect dit qu'il a deja donne ses coordonnees/adresse/contact, par exemple "je vous ai deja donne mes coordonnees", traite cela comme une relance logistique: primaryIntent = "delivery_or_availability_question", purchaseStage = "delivery_pending", ne le classe jamais en medical ni unknown.
- Les questions comme "ou le trouver" ou "ou peut-on trouver ce produit" sont des questions de disponibilite/localisation: primaryIntent = "delivery_or_availability_question".
- Les questions sur des representants dans un pays ou une ville, par exemple "avez-vous des representants au Gabon", sont des questions de disponibilite/livraison: primaryIntent = "delivery_or_availability_question".
- Les questions qui demandent seulement si nous sommes representes dans un pays ou une ville ne sont pas une demande de contact commercial: shouldNotifySales = false.
- Les demandes de numero, telephone ou contact d'un representant, par exemple "le no de votre representant en CI", doivent rester des questions de disponibilite/livraison mais shouldNotifySales = true pour permettre le relais humain.
- Si le prospect demande un contact ou numero de representant tout en indiquant qu'il appellera plus tard/quand il sera pret, c'est une temporisation: primaryIntent = "follow_up_or_deferral", objectionType = "delay_or_follow_up", purchaseStage = "none", shouldNotifySales = false. Ne relance pas la vente.
- Les questions ou informations de paiement comme "je paie par Wave", "paiement a la livraison", "Orange Money", "envoyez le lien de paiement" sont: primaryIntent = "payment_question", purchaseStage = "payment_pending".
- Les demandes de preuves, temoignages, videos, avis ou resultats sont: primaryIntent = "proof_testimonial_request", purchaseStage = "none".
- Si le prospect repond seulement "Oui", "ok" ou "c'est bon" juste apres une offre de visuels, images, videos, preuves ou temoignages, classe en "media_or_proof_request", purchaseStage = "none", shouldNotifySales = false. Ce n'est jamais une validation de commande.
- Si le prospect demande a adherer, rejoindre ou integrer un groupe de vente, ou parle de revendre/distribuer/business, primaryIntent = "business_or_reseller_interest", purchaseStage = "none", shouldNotifySales = false. Il faut clarifier son interet revendeur/groupe sans forcer une commande produit.
- Si le prospect temporise, par exemple "ok merci", "je vous reviens", "je vais reflechir", "je vais voir", "plus tard", "pas maintenant", "je reviendrai au moment opportun" ou "je vous rappelle": primaryIntent = "follow_up_or_deferral", objectionType = "delay_or_follow_up", purchaseStage = "none", shouldNotifySales = false.
- Si le prospect demande du temps pour lire, ecouter, consulter ou prendre connaissance des messages/supports/documents envoyes, c'est une temporisation: primaryIntent = "follow_up_or_deferral", objectionType = "delay_or_follow_up", purchaseStage = "none", shouldNotifySales = false.
- Si le prospect relance une commande ou une livraison deja promise, par exemple "j'ai deja commande 2 boites, vous m'avez promis la livraison avant 17h" ou "j'attends ma commande", classe en follow_up_or_deferral avec objectionType = "delay_or_follow_up" et shouldNotifySales = true.
- "Je veux vous appeler demain" ou "OK j'ai compris" sont des temporisations sans confirmation de commande: primaryIntent = "follow_up_or_deferral", purchaseStage = "none", shouldNotifySales = false.
- Si le prospect dit "je verrai selon mes moyens" ou une formulation proche, c'est une temporisation liee au budget: primaryIntent = "follow_up_or_deferral", objectionType = "delay_or_follow_up", shouldNotifySales = false.
- Si le prospect dit "j'aviserai le moment venu" ou une formulation proche, c'est une temporisation: primaryIntent = "follow_up_or_deferral", objectionType = "delay_or_follow_up", shouldNotifySales = false.
- Si le prospect relance pour obtenir une reponse, par exemple "repondez a mon message" ou "j'attends votre reponse": primaryIntent = "information_request", purchaseStage = "information", shouldNotifySales = false.
- Si le prospect se plaint que sa question n'a pas ete traitee, par exemple "vous ne repondez pas a ma question": primaryIntent = "information_request", purchaseStage = "information", shouldNotifySales = false.
- "Ok", "oui", "c'est bon" ne sont une confirmation de commande que si le contexte recent demandait explicitement de valider/confirmer la commande.
- Une quantite seule comme "2 boites svp" signifie quantity_selected, pas order_confirmation.
- La livraison ne doit etre consideree comme pertinente que si le prospect donne ou demande un lieu/frais/delai de livraison.
- shouldNotifySales doit etre true seulement pour une intention d'achat claire, une quantite selectionnee, ou une confirmation de commande.

Schema JSON obligatoire:
{
  "primaryIntent": "information_request|price_inquiry|purchase_intent|dosage_usage_question|health_condition_question|product_composition_question|delivery_or_availability_question|payment_question|proof_testimonial_request|media_or_proof_request|business_or_reseller_interest|follow_up_or_deferral|order_confirmation|conversation_closing|unknown",
  "secondaryIntents": ["intent secondaire optionnel"],
  "purchaseStage": "none|information|quantity_needed|ready_to_order|quantity_selected|order_confirmation|delivery_pending|payment_pending|completed",
  "quantity": number|null,
  "deliveryLocation": "string|null",
  "paymentMode": "cash_on_delivery|mobile_money|wave|orange_money|moov_money|mtn_money|card|unknown|null",
  "objectionType": "price_high|price_or_budget|delay_or_follow_up|spouse_or_relative|delivery|payment|composition|safety_or_medical|availability|trust_or_proof|efficacy|unknown|null",
  "medicalConcern": true|false,
  "conversationClosed": true|false,
  "shouldNotifySales": true|false,
  "confidence": 0.0,
  "reason": "courte justification en francais"
}

Dernier message prospect:
${JSON.stringify(recipient.messageBody || '')}

Contexte recent:
${JSON.stringify(compactConversation(conversation))}

Variables de session:
${JSON.stringify(sessionVariables)}

Use case:
${JSON.stringify({ useCase: useCase.useCase, modelId: useCase.modelId })}

Retourne uniquement le JSON.`
}

const normalizeNullableEnum = (value, allowedValues) => {
  if (value === undefined || value === null || value === '') return null
  const normalized = String(value)
  return allowedValues.has(normalized) ? normalized : 'unknown'
}

const normalizeClassification = (rawClassification = {}) => {
  const quantity = Number(rawClassification.quantity)

  return {
    primaryIntent: ALLOWED_PRIMARY_INTENTS.has(rawClassification.primaryIntent)
      ? rawClassification.primaryIntent
      : DEFAULT_CLASSIFICATION.primaryIntent,
    secondaryIntents: Array.isArray(rawClassification.secondaryIntents)
      ? rawClassification.secondaryIntents.filter((intent) => ALLOWED_PRIMARY_INTENTS.has(intent) && intent !== rawClassification.primaryIntent)
      : [],
    purchaseStage: ALLOWED_PURCHASE_STAGES.has(rawClassification.purchaseStage)
      ? rawClassification.purchaseStage
      : DEFAULT_CLASSIFICATION.purchaseStage,
    quantity: Number.isInteger(quantity) && quantity > 0 && quantity <= 99 ? quantity : null,
    deliveryLocation: rawClassification.deliveryLocation ? String(rawClassification.deliveryLocation).slice(0, 120) : null,
    paymentMode: normalizeNullableEnum(rawClassification.paymentMode, ALLOWED_PAYMENT_MODES),
    objectionType: normalizeNullableEnum(rawClassification.objectionType, ALLOWED_OBJECTION_TYPES),
    medicalConcern: Boolean(rawClassification.medicalConcern),
    conversationClosed: Boolean(rawClassification.conversationClosed),
    shouldNotifySales: Boolean(rawClassification.shouldNotifySales),
    confidence: Math.max(0, Math.min(1, Number(rawClassification.confidence) || 0)),
    reason: String(rawClassification.reason || DEFAULT_CLASSIFICATION.reason).slice(0, 300)
  }
}

const applyDeterministicOverrides = (classification = DEFAULT_CLASSIFICATION, event = {}) => {
  const message = event.recipient?.messageBody || ''
  const previousConversationState = parseSessionJson(event.sessionVariables?.strandsConversationState, {})
  const previousMedicalConcern = Boolean(previousConversationState.knownProspectInfo?.medicalConcern)
  const previousIntent = previousConversationState.currentIntent
  const previousQuantity = previousConversationState.knownProspectInfo?.quantity || event.sessionVariables?.knownBoxQuantity || null

  if (isStandaloneUrl(message)) {
    return {
      ...classification,
      primaryIntent: 'unknown',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.8),
      reason: 'Le prospect a envoye uniquement une URL sans intention explicite.'
    }
  }

  if (hasExternalPromotionSignal(message) || hasWrongTopicCorrectionSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'unknown',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.86),
      reason: 'Le message est hors sujet ou corrige une confusion, sans demande claire sur Miira-Cell+.'
    }
  }

  if (hasInappropriateAdultContentSignal(message) || hasLowInformationGreetingSignal(message) || hasPersonalContextOnlySignal(message) || hasUnclearSocialMessageSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'unknown',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.82),
      reason: 'Le message ne contient pas une demande claire liee au produit, a la sante, au paiement ou a la livraison.'
    }
  }

  if (hasConversationClosingSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'conversation_closing',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      objectionType: null,
      conversationClosed: true,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.86),
      reason: 'Le prospect cloture poliment la conversation.'
    }
  }

  if (hasWhatsAppContactOnlySignal(message)) {
    return {
      ...classification,
      primaryIntent: 'business_or_reseller_interest',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.86),
      reason: 'Le prospect demande le contact WhatsApp sans confirmer encore un interet partenaire ou une commande.'
    }
  }

  if (previousIntent === 'business_or_reseller_interest' && hasContextualBusinessPartnerFollowUpSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'business_or_reseller_interest',
      secondaryIntents: buildSecondaryIntents(message, 'business_or_reseller_interest'),
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: hasExplicitBusinessPartnerHandoffSignal(message),
      confidence: Math.max(classification.confidence, 0.88),
      reason: hasExplicitBusinessPartnerHandoffSignal(message)
        ? 'Le prospect confirme explicitement son interet partenaire ou revendeur apres clarification.'
        : 'Le prospect poursuit la demande de renseignements business apres clarification.'
    }
  }

  if (hasOrderConfirmationSignal(message, event.conversation)) {
    if (previousQuantity) {
      return {
        ...classification,
        primaryIntent: 'purchase_intent',
        secondaryIntents: [],
        purchaseStage: 'order_confirmation',
        quantity: Number(previousQuantity) || previousQuantity,
        deliveryLocation: null,
        paymentMode: null,
        objectionType: null,
        medicalConcern: false,
        conversationClosed: false,
        shouldNotifySales: true,
        confidence: Math.max(classification.confidence, 0.88),
        reason: 'Le prospect confirme explicitement la commande avec une quantite deja connue.'
      }
    }

    return {
      ...classification,
      primaryIntent: 'order_confirmation',
      secondaryIntents: buildSecondaryIntents(message, 'order_confirmation'),
      purchaseStage: 'order_confirmation',
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence, 0.88),
      reason: 'Le prospect confirme explicitement la commande dans un contexte de validation.'
    }
  }

  if (hasSimpleAffirmationSignal(message) && hasRecentMediaOrProofOffer(event.conversation)) {
    return {
      ...classification,
      primaryIntent: 'media_or_proof_request',
      secondaryIntents: buildSecondaryIntents(message, 'media_or_proof_request'),
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: 'trust_or_proof',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.86),
      reason: 'Le prospect confirme une offre recente de visuels, preuves ou temoignages; ce n est pas une validation de commande.'
    }
  }

  if (hasSimpleAffirmationSignal(message) && previousIntent === 'delivery_or_availability_question') {
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: 'delay_or_follow_up',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.84),
      reason: 'Le prospect accuse reception apres une reponse de livraison; ce n est pas une confirmation de commande.'
    }
  }

  if (hasTreatmentNormalQuantityQuestionSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'dosage_usage_question',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      objectionType: 'safety_or_medical',
      medicalConcern: true,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.84),
      reason: 'Le prospect demande une quantite de boites pour un traitement, ce qui doit rester prudent medicalement.'
    }
  }

  if (hasHighBoxCountTreatmentQuestionSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'dosage_usage_question',
      secondaryIntents: buildSecondaryIntents(message, 'dosage_usage_question'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: hasTreatmentBudgetConcernSignal(message) ? 'price_or_budget' : 'safety_or_medical',
      medicalConcern: true,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.88),
      reason: 'Le prospect demande si un nombre eleve de boites est necessaire pour un traitement; ce n est pas une commande.'
    }
  }

  if (hasMedicalConcernSignal(message)) {
    if (hasProofTestimonialSignal(message)) {
      return {
        ...classification,
        primaryIntent: 'proof_testimonial_request',
        secondaryIntents: buildSecondaryIntents(message, 'proof_testimonial_request'),
        purchaseStage: 'none',
        quantity: null,
        objectionType: 'trust_or_proof',
        medicalConcern: true,
        shouldNotifySales: false,
        confidence: Math.max(classification.confidence, 0.85),
        reason: 'Le prospect demande des temoignages ou preuves dans un contexte medical.'
      }
    }

    return {
      ...classification,
      primaryIntent: 'health_condition_question',
      secondaryIntents: buildSecondaryIntents(message, 'health_condition_question'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: 'safety_or_medical',
      medicalConcern: true,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.85),
      reason: 'Le prospect mentionne une condition medicale ou un risque de sante.'
    }
  }

  if (hasDeferralDominantSignal(message)) {
    const softQuantity = extractBoxQuantity(message) || classification.quantity || null
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: buildSecondaryIntents(message, 'follow_up_or_deferral'),
      purchaseStage: 'none',
      quantity: softQuantity,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: hasPriceHighObjectionSignal(message) ? 'price_or_budget' : 'delay_or_follow_up',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.86),
      reason: softQuantity
        ? 'Le prospect indique une preference de quantite tout en reportant sa decision.'
        : 'Le prospect temporise, evoque le budget ou indique vouloir revenir plus tard.'
    }
  }

  if (hasQuestionReminderSignal(message) && previousIntent === 'delivery_or_availability_question') {
    return {
      ...classification,
      primaryIntent: 'delivery_or_availability_question',
      secondaryIntents: buildSecondaryIntents(message, 'delivery_or_availability_question'),
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: selectDeliveryLocation(extractDeliveryLocation(message), classification.deliveryLocation, previousConversationState.knownProspectInfo?.deliveryLocation),
      objectionType: 'availability',
      medicalConcern: previousMedicalConcern,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.82),
      reason: 'Le prospect relance une question de disponibilite ou livraison deja posee.'
    }
  }

  if (hasAiSuspicionSignal(message) && previousIntent === 'delivery_or_availability_question') {
    return {
      ...classification,
      primaryIntent: 'delivery_or_availability_question',
      secondaryIntents: buildSecondaryIntents(message, 'delivery_or_availability_question'),
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: selectDeliveryLocation(extractDeliveryLocation(message), classification.deliveryLocation, previousConversationState.knownProspectInfo?.deliveryLocation),
      objectionType: 'availability',
      medicalConcern: previousMedicalConcern,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.82),
      reason: 'Le prospect doute de l interlocuteur mais une question de disponibilite reste en attente.'
    }
  }

  if (hasAiSuspicionSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'information_request',
      secondaryIntents: buildSecondaryIntents(message, 'information_request'),
      purchaseStage: 'information',
      quantity: null,
      objectionType: 'trust_or_proof',
      medicalConcern: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.78),
      reason: 'Le prospect doute de parler a une IA; il faut rassurer et inviter a poser sa question.'
    }
  }

  if (hasAntiHardSellQuestioningSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'information_request',
      secondaryIntents: buildSecondaryIntents(message, 'information_request'),
      purchaseStage: 'information',
      quantity: null,
      objectionType: 'unknown',
      medicalConcern: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.82),
      reason: 'Le prospect refuse une relance de commande prematuree et souhaite poser des questions.'
    }
  }

  if (hasPackClarificationSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'information_request',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      objectionType: null,
      medicalConcern: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.78),
      reason: 'Le prospect demande une clarification sur les packs, sans selection de quantite.'
    }
  }

  if (hasSafetyProofSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'proof_testimonial_request',
      secondaryIntents: buildSecondaryIntents(message, 'proof_testimonial_request'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: 'trust_or_proof',
      medicalConcern: true,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.82),
      reason: 'Le prospect demande des preuves ou garanties liees a la securite du produit.'
    }
  }

  if (hasDeliveryFollowUpSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: buildSecondaryIntents(message, 'follow_up_or_deferral'),
      purchaseStage: previousConversationState.currentPurchaseStage || 'delivery_pending',
      quantity: extractBoxQuantity(message) || previousConversationState.knownProspectInfo?.quantity || null,
      deliveryLocation: classification.deliveryLocation || previousConversationState.knownProspectInfo?.deliveryLocation || extractDeliveryLocation(message),
      objectionType: 'delay_or_follow_up',
      medicalConcern: previousMedicalConcern,
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence, 0.86),
      reason: 'Le prospect relance le suivi d une commande ou d une livraison deja promise.'
    }
  }

  if (hasAlreadyAnsweredSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: previousConversationState.knownProspectInfo?.quantity || classification.quantity || null,
      deliveryLocation: selectDeliveryLocation(previousConversationState.knownProspectInfo?.deliveryLocation, classification.deliveryLocation),
      objectionType: 'delay_or_follow_up',
      medicalConcern: previousMedicalConcern,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.84),
      reason: 'Le prospect indique avoir deja repondu; il faut repondre directement sans repeter les questions logistiques.'
    }
  }

  if (hasDeliveryDetailsSignal(message) && !hasPaymentSignal(message) && !(hasQuantitySignal(message) || hasReadyToOrderSignal(message))) {
    if (hasInformationRequestSignal(message)) {
      return {
        ...classification,
        primaryIntent: 'information_request',
        secondaryIntents: buildSecondaryIntents(message, 'information_request'),
        purchaseStage: 'information',
        quantity: null,
        deliveryLocation: selectDeliveryLocation(extractDeliveryLocation(message), classification.deliveryLocation, previousConversationState.knownProspectInfo?.deliveryLocation),
        objectionType: null,
        medicalConcern: previousMedicalConcern,
        shouldNotifySales: false,
        confidence: Math.max(classification.confidence, 0.84),
        reason: 'Le prospect demande des informations tout en donnant son contexte de livraison.'
      }
    }

    return {
      ...classification,
      primaryIntent: 'delivery_or_availability_question',
      secondaryIntents: buildSecondaryIntents(message, 'delivery_or_availability_question'),
      purchaseStage: previousConversationState.knownProspectInfo?.quantity || classification.quantity || extractBoxQuantity(message)
        ? 'delivery_pending'
        : classification.purchaseStage === 'order_confirmation'
          ? 'delivery_pending'
          : 'delivery_pending',
      quantity: classification.quantity || previousConversationState.knownProspectInfo?.quantity || extractBoxQuantity(message),
      deliveryLocation: selectDeliveryLocation(extractDeliveryLocation(message), classification.deliveryLocation, previousConversationState.knownProspectInfo?.deliveryLocation),
      objectionType: null,
      medicalConcern: previousMedicalConcern,
      shouldNotifySales: hasRepresentativeContactRequestSignal(message) ||
        Boolean(previousConversationState.knownProspectInfo?.quantity || classification.quantity || extractBoxQuantity(message)),
      confidence: Math.max(classification.confidence, 0.84),
      reason: 'Le prospect donne ou rappelle des informations de livraison.'
    }
  }

  if (hasBusinessOrResellerInterestSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'business_or_reseller_interest',
      secondaryIntents: buildSecondaryIntents(message, 'business_or_reseller_interest'),
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.86),
      reason: 'Le prospect demande a rejoindre un groupe de vente ou exprime un interet business/revendeur.'
    }
  }

  if (hasDelayOrFollowUpSignal(message) && !hasPriceInquirySignal(message) && !hasInformationRequestSignal(message)) {
    const softQuantity = extractBoxQuantity(message) || classification.quantity || null
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: buildSecondaryIntents(message, 'follow_up_or_deferral'),
      purchaseStage: 'none',
      quantity: softQuantity,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: hasPriceHighObjectionSignal(message) ? 'price_high' : 'delay_or_follow_up',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.8),
      reason: softQuantity
        ? 'Le prospect indique une preference de quantite tout en reportant sa decision.'
        : 'Le prospect temporise ou indique vouloir revenir plus tard.'
    }
  }

  if (previousMedicalConcern && hasTreatmentQuantityQuestionSignal(message) &&
    !hasQuantitySignal(message) && !hasReadyToOrderSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'dosage_usage_question',
      secondaryIntents: buildSecondaryIntents(message, 'dosage_usage_question'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: 'safety_or_medical',
      medicalConcern: true,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.84),
      reason: 'Le prospect pose une question de quantite ou de cure dans un contexte medical deja etabli.'
    }
  }

  if (hasPriceHighObjectionSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: buildSecondaryIntents(message, 'follow_up_or_deferral'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: 'price_high',
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.82),
      reason: 'Le prospect exprime une objection sur le prix ou demande une baisse.'
    }
  }

  if (hasPriceInquirySignal(message) && !hasExplicitBoxQuantityWithPackSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'price_inquiry',
      secondaryIntents: buildSecondaryIntents(message, 'price_inquiry'),
      purchaseStage: hasPaymentCalculationSignal(message) ? 'payment_pending' : 'none',
      quantity: null,
      objectionType: null,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.8),
      reason: 'Le prospect demande le prix ou le cout du produit.'
    }
  }

  if (hasInformationRequestSignal(message) && hasBusinessLocationQuestionSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'information_request',
      secondaryIntents: buildSecondaryIntents(message, 'information_request'),
      purchaseStage: 'information',
      quantity: null,
      deliveryLocation: null,
      objectionType: 'availability',
      medicalConcern: previousMedicalConcern,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.84),
      reason: 'Le prospect demande des informations produit et la localisation de l entreprise.'
    }
  }

  if (hasDeliveryOrAvailabilitySignal(message) && extractDeliveryLocation(message) && hasPaymentSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'delivery_or_availability_question',
      secondaryIntents: buildSecondaryIntents(message, 'delivery_or_availability_question'),
      purchaseStage: classification.purchaseStage === 'order_confirmation' ? 'delivery_pending' : 'none',
      quantity: null,
      deliveryLocation: selectDeliveryLocation(extractDeliveryLocation(message), classification.deliveryLocation),
      objectionType: null,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.82),
      reason: 'Le prospect donne un lieu et demande comment se passent le paiement et la livraison.'
    }
  }

  if (hasPaymentSignal(message)) {
    const paymentMode = extractPaymentMode(message)
    return {
      ...classification,
      primaryIntent: 'payment_question',
      secondaryIntents: buildSecondaryIntents(message, 'payment_question'),
      purchaseStage: 'payment_pending',
      quantity: null,
      paymentMode,
      objectionType: null,
      shouldNotifySales: Boolean(previousConversationState.knownProspectInfo?.quantity),
      confidence: Math.max(classification.confidence, 0.8),
      reason: 'Le prospect pose une question ou donne une information de paiement.'
    }
  }

  if (hasQuantitySignal(message) &&
    previousQuantity &&
    (previousConversationState.knownProspectInfo?.deliveryLocation || event.sessionVariables?.knownDeliveryLocation) &&
    String(event.sessionVariables?.orderValidationAsked || '').toLowerCase() === 'true' &&
    String(extractBoxQuantity(message) || '') === String(previousQuantity)) {
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: [],
      purchaseStage: 'order_confirmation',
      quantity: Number(previousQuantity) || previousQuantity,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence, 0.88),
      reason: 'Le prospect confirme la meme quantite apres recapitulatif et lieu de livraison deja connus.'
    }
  }

  if (hasPossessionPurchaseSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: buildSecondaryIntents(message, 'purchase_intent'),
      purchaseStage: 'ready_to_order',
      quantity: null,
      deliveryLocation: selectDeliveryLocation(extractDeliveryLocation(message), classification.deliveryLocation),
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence, 0.8),
      reason: 'Le prospect demande comment entrer en possession du produit.'
    }
  }

  if (hasQuantitySignal(message)) {
    const quantity = extractBoxQuantity(message)
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: buildSecondaryIntents(message, 'purchase_intent'),
      purchaseStage: 'quantity_selected',
      quantity,
      deliveryLocation: selectDeliveryLocation(extractDeliveryLocation(message), classification.deliveryLocation),
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence, 0.82),
      reason: `Le prospect indique une quantite de ${quantity} boite(s).`
    }
  }

  if (hasDeliveryOrAvailabilitySignal(message)) {
    return {
      ...classification,
      primaryIntent: 'delivery_or_availability_question',
      secondaryIntents: buildSecondaryIntents(message, 'delivery_or_availability_question'),
      purchaseStage: classification.purchaseStage === 'order_confirmation' ? 'delivery_pending' : 'none',
      quantity: null,
      deliveryLocation: selectDeliveryLocation(extractDeliveryLocation(message), classification.deliveryLocation),
      objectionType: null,
      shouldNotifySales: hasRepresentativeContactRequestSignal(message),
      confidence: Math.max(classification.confidence, 0.78),
      reason: 'Le prospect pose une question de livraison, localisation ou disponibilite.'
    }
  }

  if (previousMedicalConcern && hasReadyToOrderSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: buildSecondaryIntents(message, 'purchase_intent'),
      purchaseStage: 'ready_to_order',
      quantity: null,
      medicalConcern: true,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.78),
      reason: 'Le prospect demande comment commander apres un contexte medical; rester sobre et sans notification commerciale.'
    }
  }

  if (hasReadyToOrderSignal(message)) {
    const directOrderWithoutQuantity = /\b(?:je\s+)?(?:veux|souhaite|voudrais|aimerais|vais)\s+(?:commander|acheter|prendre|passer\s+commande)\b/.test(normalizeText(message)) ||
      /\b(?:je\s+)?(?:commande|achete|prends)\b/.test(normalizeText(message))
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: buildSecondaryIntents(message, 'purchase_intent'),
      purchaseStage: directOrderWithoutQuantity ? 'quantity_needed' : 'ready_to_order',
      quantity: null,
      shouldNotifySales: !directOrderWithoutQuantity,
      confidence: Math.max(classification.confidence, 0.75),
      reason: directOrderWithoutQuantity
        ? 'Le prospect exprime une volonte de commander sans quantite; il faut demander la quantite avant notification commerciale.'
        : 'Le prospect exprime clairement une volonte de commander ou un interet d achat fort.'
    }
  }

  if (hasProofTestimonialSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'proof_testimonial_request',
      secondaryIntents: buildSecondaryIntents(message, 'proof_testimonial_request'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: 'trust_or_proof',
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.8),
      reason: 'Le prospect demande une preuve, un temoignage ou une video.'
    }
  }

  if (hasPackageContentSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'dosage_usage_question',
      secondaryIntents: buildSecondaryIntents(message, 'dosage_usage_question'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: 'composition',
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.82),
      reason: 'Le prospect demande le contenu de la boite.'
    }
  }

  if (hasProductAndIngredientsSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'product_composition_question',
      secondaryIntents: buildSecondaryIntents(message, 'product_composition_question'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: 'composition',
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.84),
      reason: 'Le prospect demande des informations sur le produit et ses ingredients.'
    }
  }

  if (hasDosageUsageSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'dosage_usage_question',
      secondaryIntents: buildSecondaryIntents(message, 'dosage_usage_question'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: null,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.78),
      reason: 'Le prospect pose une question de prise, dosage, duree ou mode d emploi.'
    }
  }

  if (hasProductCompositionSignal(message) && !hasInformationRequestSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'product_composition_question',
      secondaryIntents: buildSecondaryIntents(message, 'product_composition_question'),
      purchaseStage: 'none',
      quantity: null,
      objectionType: 'composition',
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.76),
      reason: 'Le prospect demande des informations sur la composition ou la nature du produit.'
    }
  }

  if (hasQuestionReminderSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'information_request',
      secondaryIntents: buildSecondaryIntents(message, 'information_request'),
      purchaseStage: 'information',
      quantity: null,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.72),
      reason: 'Le prospect relance pour obtenir une reponse a ses questions.'
    }
  }

  if (hasInformationRequestSignal(message) && !hasReadyToOrderSignal(message) && !hasQuantitySignal(message)) {
    return {
      ...classification,
      primaryIntent: 'information_request',
      secondaryIntents: buildSecondaryIntents(message, 'information_request'),
      purchaseStage: 'information',
      quantity: null,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence, 0.75),
      reason: 'Le prospect demande des informations sans intention d achat explicite.'
    }
  }

  return classification
}

const isDeterministicClassification = (classification = DEFAULT_CLASSIFICATION) => {
  return classification.primaryIntent !== DEFAULT_CLASSIFICATION.primaryIntent ||
    classification.purchaseStage !== DEFAULT_CLASSIFICATION.purchaseStage ||
    classification.medicalConcern ||
    classification.shouldNotifySales ||
    classification.conversationClosed
}

const buildStrandsAgent = (event = {}) => {
  const modelId = process.env.STRANDS_CLASSIFIER_MODEL_ID || event.useCase?.modelId || 'amazon.nova-lite-v1:0'
  const model = new BedrockModel({
    modelId,
    region: process.env.AWS_REGION,
    temperature: Number(process.env.STRANDS_CLASSIFIER_TEMPERATURE || 0),
    maxTokens: Number(process.env.STRANDS_CLASSIFIER_MAX_TOKENS || 700)
  })

  return new Agent({
    model,
    structuredOutputSchema: IntentClassificationSchema,
    printer: false
  })
}

const classifyWithStrands = async (event) => {
  const deterministicClassification = applyDeterministicOverrides(DEFAULT_CLASSIFICATION, event)
  if (isDeterministicClassification(deterministicClassification)) {
    return deterministicClassification
  }

  const prompt = buildClassificationPrompt(event)
  const agent = buildStrandsAgent(event)
  const result = await agent.invoke(prompt)

  const classification = normalizeClassification(result.structuredOutput || DEFAULT_CLASSIFICATION)
  return applyDeterministicOverrides(classification, event)
}

exports.handler = async (event, _context, callback) => {
  try {
    console.info('Strands intent classifier invoked in shadow mode.')
    const classification = await classifyWithStrands(event || {})

    console.info('Strands intent classification completed.', {
      primaryIntent: classification.primaryIntent,
      purchaseStage: classification.purchaseStage,
      shouldNotifySales: classification.shouldNotifySales,
      confidence: classification.confidence
    })

    callback(null, {
      source: 'strands-intent-classifier',
      shadowMode: true,
      classification
    })
  } catch (error) {
    console.error('Strands intent classification failed.', {
      errorName: error.name,
      errorMessage: error.message
    })

    callback(null, {
      source: 'strands-intent-classifier',
      shadowMode: true,
      classification: DEFAULT_CLASSIFICATION,
      error: error.message
    })
  }
}
