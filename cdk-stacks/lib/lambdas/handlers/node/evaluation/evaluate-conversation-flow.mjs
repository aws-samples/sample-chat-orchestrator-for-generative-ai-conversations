import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DEFAULT_CASES_FILE = resolve(__dirname, 'strands-conversation-flow-evaluated-cases.json')
const DEFAULT_OUTPUT_FILE = resolve(__dirname, 'results/strands-conversation-flow-report.json')

const DEFAULT_USE_CASE = {
  useCase: 'agent',
  modelId: 'amazon.nova-lite-v1:0',
  agentId: process.env.BEDROCK_AGENT_ID,
  agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID
}

const parseArgs = (argv = []) => {
  const args = {
    casesFile: DEFAULT_CASES_FILE,
    classifierLambdaName: process.env.STRANDS_INTENT_CLASSIFIER_LAMBDA_NAME,
    responseGeneratorLambdaName: process.env.AGENT_RESPONSE_GENERATOR_LAMBDA_NAME,
    outputFile: DEFAULT_OUTPUT_FILE,
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
    useCaseFile: null,
    failFast: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--cases') args.casesFile = resolve(process.cwd(), argv[++index])
    else if (arg === '--classifier-lambda-name') args.classifierLambdaName = argv[++index]
    else if (arg === '--response-generator-lambda-name') args.responseGeneratorLambdaName = argv[++index]
    else if (arg === '--output') args.outputFile = resolve(process.cwd(), argv[++index])
    else if (arg === '--region') args.region = argv[++index]
    else if (arg === '--use-case') args.useCaseFile = resolve(process.cwd(), argv[++index])
    else if (arg === '--fail-fast') args.failFast = true
    else if (arg === '--help' || arg === '-h') args.help = true
  }

  return args
}

const printHelp = () => {
  console.log(`Usage:
  node evaluation/evaluate-conversation-flow.mjs \\
    --classifier-lambda-name <strandsIntentClassifierLambda> \\
    --response-generator-lambda-name <agentResponseGeneratorLambda> \\
    --use-case evaluation/use-case.agent.json

Options:
  --classifier-lambda-name         Deployed Strands intent classifier Lambda. Can also use STRANDS_INTENT_CLASSIFIER_LAMBDA_NAME.
  --response-generator-lambda-name Deployed agent response generator Lambda. Can also use AGENT_RESPONSE_GENERATOR_LAMBDA_NAME.
  --use-case                       Optional JSON file merged into the useCase object. Use it for agentId, agentAliasId, KB config, etc.
  --cases                          Multi-turn cases JSON. Defaults to evaluation/strands-conversation-flow-evaluated-cases.json.
  --output                         JSON report path. Defaults to evaluation/results/strands-conversation-flow-report.json.
  --region                         AWS region. Defaults to AWS_REGION, AWS_DEFAULT_REGION, then us-east-1.
  --fail-fast                      Stop after first failing turn.
`)
}

const loadJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

const loadCases = (casesFile) => {
  const cases = loadJson(casesFile)
  if (!Array.isArray(cases)) throw new Error('Cases file must contain a JSON array.')
  return cases
}

const loadUseCase = (useCaseFile) => {
  const fileUseCase = useCaseFile ? loadJson(useCaseFile) : {}
  const useCase = {
    ...DEFAULT_USE_CASE,
    ...fileUseCase
  }

  if (!useCase.agentId || !useCase.agentAliasId) {
    throw new Error('Missing useCase.agentId/useCase.agentAliasId. Provide --use-case or BEDROCK_AGENT_ID/BEDROCK_AGENT_ALIAS_ID.')
  }

  return useCase
}

const normalizeText = (value = '') => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const parseSessionJson = (value, fallback) => {
  if (!value) return fallback
  if (typeof value === 'object') return value

  try {
    return JSON.parse(value)
  } catch (_error) {
    return fallback
  }
}

const uniqueList = (values = []) => [...new Set(values.filter(Boolean))]

const isValidDeliveryLocationValue = (value = '') => {
  const normalizedValue = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return Boolean(normalizedValue) &&
    !/\b\d{2,5}\s*k\b/.test(normalizedValue) &&
    !/\b\d[\d\s.,]*(?:fcfa|f\s*cfa|xof)\b/.test(normalizedValue) &&
    !/\b(?:ce sujet|sujet|temps|combien|question|message|propos|produits?|traitement|traiter|efficacement|boites?|paquets?|packs?|sachets?|poudre|myomes?|fibromes?|ulceres?|buruli|glycemie|diabete|arthrose|pathologie|maladie|gueri|guerit|guerir|disparaitre|disparait|aider|argent|budget|moyens|enfants?|famille|reduction|vente|commande|commander|achete|acheter|prendre|confirme|confirmer|valide|valider|bientot|incessamment|interesse|interessee|reveni?r|reviendrai)\b/.test(normalizedValue)
}

const firstValidDeliveryLocation = (...values) => {
  const value = values.find((candidate) => isValidDeliveryLocationValue(candidate))
  if (!value) return null

  const normalizedValue = normalizeGuidanceText(value)
  if (/\bcote\s+d[' ]?ivoire\b|\bcote\s+divoire\b/.test(normalizedValue)) return "Cote d'Ivoire"
  return value
}

const hasSentProductMedia = (value) => {
  if (!value) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value !== 'string') return Boolean(value)

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed)
  } catch (_error) {
    return value.trim() !== '[]'
  }
}

const normalizeGuidanceText = (value = '') => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const extractGuidanceDeliveryLocation = (message = '') => {
  const rawMessage = String(message || '').trim()
  const value = normalizeGuidanceText(message)
  if (/\blibreville\s+au\s+gabon\b/.test(value)) return 'Libreville au Gabon'
  if (/\blibreville\b/.test(value) && /\bgabon\b/.test(value)) return 'Libreville au Gabon'
  if (/\blibreville\b/.test(value)) return 'Libreville'
  if (/\bgabon\b/.test(value)) return 'Gabon'
  if ((/\bcote\s+d[' ]?ivoire\b|\bcote\s+divoire\b/.test(value)) && /\babidjan\b/.test(value)) return "Cote d'Ivoire"
  if (/\bcote\s+d[' ]?ivoire\b|\bcote\s+divoire\b/.test(value)) return "Cote d'Ivoire"
  if (/\bci\b/.test(value)) return 'CI'
  if (/\bguinee\b/.test(value) || String(message || '').includes('🇬🇳') || String(message || '').includes('ðŸ‡¬ðŸ‡³')) return 'Guinee'

  if (!/[?]/.test(rawMessage) &&
    rawMessage.length >= 12 &&
    /\b(?:abidjan|yopougon|cocody|plateau|libreville|port[-\s]?gentil)\b/.test(value) &&
    !/\b(?:combien|prix|payer|paiement|mobile money|wave|orange money|moov|mtn|visa|boites?|sachets?)\b/.test(value)) {
    return rawMessage.replace(/[.!?]+$/, '').trim()
  }

  const residenceMatch = value.match(/\b(?:je\s+)?(?:vis|vit|reside|habite|suis)\s+(?:a|au|aux|dans|en)\s+(.{3,90})$/)
  if (residenceMatch?.[1]) {
    const candidate = residenceMatch[1]
      .replace(/\b(?:pour|afin|concernant)\b.*$/i, '')
      .replace(/[.!?]+$/, '')
      .trim()
    if (isValidDeliveryLocationValue(candidate)) {
      return candidate
        .replace(/\babidjan\b/i, 'Abidjan')
        .replace(/\byopougon\b/i, 'Yopougon')
        .replace(/\bcocody\b/i, 'Cocody')
    }
  }
  return null
}

const hasGuidanceResidenceLocationSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:je\s+)?(?:vis|vit|reside|habite|suis)\s+(?:a|au|aux|dans|en)\s+.{3,90}$/.test(value)
}

const hasGuidanceRepresentativeContactRequestSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:contact|numero|telephone|tel|no|num)\b.{0,60}\brepresentants?\b/.test(value) ||
    /\brepresentants?\b.{0,60}\b(?:contact|numero|telephone|tel|no|num)\b/.test(value)
}

const hasGuidanceRepresentativeAvailabilityQuestionSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:represente|representes|representation|representants?)\b/.test(value) &&
    !hasGuidanceRepresentativeContactRequestSignal(message)
}

const hasGuidanceGeneralDeliveryQuestionSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:vous\s+faites?\s+des\s+livraisons?|faites\s+vous\s+des\s+livraisons?|livrez\s+vous|vous\s+livrez|livraison\s+possible)\b/.test(value)
}

const hasGuidanceSentMessagesReviewSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:laiss(?:e|ez|er)|donne[rz]?|accorde[rz]?)(?:\s|-)+(?:moi|nous)\s+(?:le\s+)?temps\s+de\s+(?:lire|ecouter|consulter|voir|prendre\s+connaissance)\b.{0,80}\b(?:messages?|audios?|documents?|supports?|infos?|informations?)\s+envoy(?:e|es|ees)\b/.test(value) ||
    /\b(?:laiss(?:e|ez|er)|donne[rz]?|accorde[rz]?)(?:\s|-)+(?:moi|nous)\s+(?:prendre\s+connaissance|lire|ecouter|consulter|voir)\b.{0,80}\b(?:messages?|audios?|documents?|supports?|infos?|informations?)\s+envoy(?:e|es|ees)\b/.test(value) ||
    /\b(?:je\s+vais|je\s+veux|je\s+voudrais|je\s+souhaite)\s+(?:d['’ ]?abord\s+)?(?:lire|ecouter|consulter|voir|prendre\s+connaissance)\b.{0,80}\b(?:messages?|audios?|documents?|supports?|infos?|informations?)\s+envoy(?:e|es|ees)\b/.test(value) ||
    /\b(?:je\s+vais|je\s+veux|je\s+voudrais|je\s+souhaite)\s+(?:d['’ ]?abord\s+)?(?:prendre\s+connaissance|lire|ecouter|consulter|voir)\b/.test(value)
}

const hasGuidanceDelayOrFollowUpSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return hasGuidanceSentMessagesReviewSignal(message) ||
    /\b(?:je\s+(?:vous\s+)?reviens|je\s+reviens\s+vers\s+vous|je\s+vais\s+(?:vous\s+)?revenir|je\s+(?:vous\s+)?reviendrai|je\s+(?:vous\s+)?reviendrais|je\s+vous\s+rappelle|je\s+vous\s+(?:re)?contacte|je\s+(?:vais\s+)?vous\s+fais\s+signe|je\s+vais\s+organiser)\b/.test(value) ||
    /\b(?:a\s+)?(?:tres\s+)?bientot\b/.test(value) ||
    /\bincessamment\b/.test(value) ||
    /\b(?:plus\s+tard|pas\s+maintenant|moment\s+opportun|je\s+vais\s+reflechir|je\s+vais\s+voir|fin\s+(?:du|de)\s+mois|apres\s+salaire|pas\s+(?:en\s+)?possession\s+de\s+l[' ]?argent)\b/.test(value) ||
    /\b(?:discuter|parler|voir)\s+avec\s+(?:mes|nos|mon|ma|m[a-z]+)\s+(?:enfants?|epoux|epouse|mari|femme|famille)\b/.test(value)
}

const hasGuidanceConversationClosingSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /^(?:a\s+bientot|au\s+revoir|bonne\s+journee|bonne\s+soiree|salut)\s*!?\.?$/.test(value) ||
    /^(?:merci\s+)?(?:bne|bnne|bonne)\s+journee\s*!?\.?$/.test(value) ||
    /^(?:d[' ]?accord\s+)?merci\s*!?\.?$/.test(value) ||
    /\bmerci\s+pour\s+(?:tous\s+)?(?:les\s+)?(?:renseignements|informations|infos|explications)\b/.test(value)
}

const hasGuidanceMedicalConcernSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:diabete|diabetique|glycemie|arthrose|hypertension|tension|maladie|pathologie|pathologies|medecin|avis\s+medical)\b/.test(value) ||
    /\b(?:guerir|gueri|guerit|soigne|traiter|disparaitre|disparait|aider)\b/.test(value) ||
    /\b(?:ca|cela|ce\s+produit|miira[\s-]?cell)\s+peut\s+(?:m[' ]?)?aider\b/.test(value)
}

const hasGuidanceDeferralDominantSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return hasGuidanceDelayOrFollowUpSignal(message) &&
    /\b(?:commande|commander|achat|acheter|argent|budget|moyens|fonds|fin\s+du\s+mois|salaire|enfants?|famille|prix|cout|coute|combien)\b/.test(value)
}

const extractGuidanceExplicitBoxQuantityWithPack = (message = '') => {
  const value = normalizeGuidanceText(message)
  const quantityTokens = {
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
  const match = value.match(/\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:boites?|boite)\b.{0,60}\bpack\s+(?:starter|bronze)\b/) ||
    value.match(/\bpack\s+(?:starter|bronze)\b.{0,60}\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:boites?|boite)\b/)
  if (!match) return null
  return /^\d+$/.test(match[1]) ? Number(match[1]) : quantityTokens[match[1]] || null
}

const extractGuidanceBoxQuantity = (message = '') => {
  const value = normalizeGuidanceText(message)
  const quantityTokens = {
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
  const match = value.match(/\b(\d{1,2}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s*(?:boites?|boite)\b/)
  if (!match) return null
  return /^\d+$/.test(match[1]) ? Number(match[1]) : quantityTokens[match[1]] || null
}

const hasGuidanceHighBoxCountTreatmentQuestionSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:faut|falloir|necessaire|oblige|obligatoire|forcement)\b.{0,80}\b(?:\d{1,2}\s*[-a]\s*\d{1,2}|10\s*(?:a|-)\s*20)\s*boites?\b/.test(value) &&
    /\b(?:traitement|cure|traiter|soigner|guerir)\b/.test(value)
}

const hasGuidanceTreatmentBudgetConcernSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:mine\s+de\s+rien|quand\s+meme|ca\s+fait|cela\s+fait|fait)\b.{0,80}\b(?:43\s*000|43000|43\s*k|fcfa|f\s*cfa)\b/.test(value) ||
    /\b(?:1|un|une|la)\s*boites?\s*(?:fait|coute|co[uû]te|est\s+a)\s*(?:43\s*000|43000|43\s*k)\b/.test(value)
}

const hasGuidancePriceInquirySignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  // "combien de boites me faut-il" est une question de besoin/quantite, pas de prix.
  if (/\bcombien\s+de\s+(?:boites?|boite|packs?|sachets?)\b/.test(value) &&
    /\b(?:faut|faudra|faudrait|necessaire|besoin)\b/.test(value)) {
    return false
  }
  return /\b(?:prix|tarif|cout|coute|combien|montant|fait\s+combien)\b/.test(value) &&
    /\b(?:boites?|boite|pack|miira[\s-]?cell|miiracell|produit)\b/.test(value)
}

const hasGuidanceDirectOrderWithoutQuantitySignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:je\s+)?(?:veux|souhaite|voudrais|aimerais|vais)\s+(?:commander|acheter|prendre|passer\s+commande)\b/.test(value) ||
    /\b(?:je\s+)?(?:commande|achete|prends)\b/.test(value)
}

const hasGuidanceSimpleOrderConfirmationSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /^(?:confirmer|confirme|je confirme|valider|valide|je valide|ok|okay|daccord|d accord|c est bon|cest bon)[.!?]*$/.test(value)
}

const hasGuidanceExplicitOrderConfirmationSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /^(?:confirmer|confirme|je confirme|valider|valide|je valide)[.!?]*$/.test(value) ||
    /\b(?:je\s+)?(?:confirme|valide)\b.{0,40}\bcommande\b/.test(value)
}

const hasGuidanceSimpleAffirmationSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /^(?:oui|ok|okay|daccord|d accord|c est bon|cest bon|bien sur|volontiers)[.!?]*$/.test(value)
}

const hasGuidanceSoftPurchaseIntentSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:je\s+)?(?:vais|veux|voudrais|souhaite|peux|peut|pourrais|pourrait)\s+(?:aussi\s+)?(?:essayer|tester|prendre)\b.{0,50}\b(?:vos?\s+)?produits?\b/.test(value) ||
    /\b(?:je\s+)?(?:vais|veux|voudrais|souhaite|peux|peut|pourrais|pourrait)\s+(?:aussi\s+)?(?:essayer|tester)\b/.test(value)
}

const hasGuidanceBudgetBlockerSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /^(?:le\s+)?budget[.!?]*$/.test(value) ||
    /^(?:mon\s+)?budget\s+(?:me\s+)?(?:bloque|derange|gene)[.!?]*$/.test(value)
}

const hasGuidancePriorSpendOrBudgetSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:plein|beaucoup|assez|trop)\s+d[' ]?argent\b/.test(value) ||
    /\bargent\b.{0,60}\b(?:sorti|depense|perdu)\b/.test(value) ||
    /\b(?:sorti|depense|perdu)\b.{0,60}\bargent\b/.test(value) ||
    /\b(?:budget|prix|cher|chere|moyens?)\b/.test(value)
}

const hasGuidanceBusinessOrResellerInterestSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:groupe\s+de\s+vente|groupe\s+vente|groupe\s+business|business|revendeur|revendeuse|revendre|distributeur|distributrice|distribution|plan\s+d[' ]?affaire)\b/.test(value) &&
    (/\b(?:adherer|adhere|adhesion|integrer|rejoindre|entrer|inscrire|inscription|participer|partenaire|devenir)\b/.test(value) ||
      /\b(?:puis\s+je|peux\s+je|comment|possible)\b/.test(value))
}

const hasGuidanceWhatsAppContactOnlySignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /\b(?:avoir|avoi|donnez|donner|souhaite|veux|voudrais|peux\s+avoir|puis\s+avoir)\b.{0,40}\b(?:votre|ton|le)\s+(?:whatsapp|whats\s*app|numero\s+whatsapp|num\s+whatsapp)\b/.test(value) &&
    !/\b(?:partenaire|revendeur|revendeuse|revendre|business|groupe\s+de\s+vente|commande|commander|acheter|prendre)\b/.test(value)
}

const hasGuidanceContextualBusinessPartnerFollowUpSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /^(?:client\s+apres\s+revendeur|client\s+après\s+revendeur|partenaire|devenir\s+partenaire|revendeur|devenir\s+revendeur|des?\s+renseignements?|renseignements?)\.?$/.test(value) ||
    /\b(?:les\s+)?deux\s+cas\b.{0,40}\b(?:interesse|interessent|m'interesse|m'interessent)\b/.test(value) ||
    /\b(?:devenir|etre|être)\s+(?:partenaire|revendeur|revendeuse)\b/.test(value)
}

const hasGuidanceExplicitBusinessPartnerHandoffSignal = (message = '') => {
  const value = normalizeGuidanceText(message)
  return /^(?:partenaire|devenir\s+partenaire|revendeur|devenir\s+revendeur)\.?$/.test(value) ||
    /\b(?:devenir|etre|être)\s+(?:partenaire|revendeur|revendeuse)\b/.test(value)
}

const applyGuidanceClassificationFallback = (classification = {}, message = '', sessionVariables = {}) => {
  const deliveryLocation = extractGuidanceDeliveryLocation(message)
  const hasDeliverySignal = deliveryLocation || /\b(?:disponible|disponibilite|livraison|livrer|trouver|representants?|situes?)\b/.test(normalizeGuidanceText(message))
  const classifierUnavailable = !classification ||
    classification.primaryIntent === 'unknown' ||
    classification.reason === 'Classification unavailable.'
  const previousState = parseSessionJson(sessionVariables.strandsConversationState, {})
  const knownQuantity = classification.quantity || sessionVariables.knownBoxQuantity || previousState.knownProspectInfo?.quantity || null
  const contextualSimpleOrderConfirmation = hasGuidanceSimpleOrderConfirmationSignal(message) &&
    String(sessionVariables.orderValidationAsked || '').toLowerCase() === 'true' &&
    previousState.currentIntent === 'purchase_intent' &&
    ['quantity_selected', 'ready_to_order'].includes(previousState.currentPurchaseStage)
  const contextualOrderConfirmation = hasGuidanceExplicitOrderConfirmationSignal(message) || contextualSimpleOrderConfirmation

  if (hasGuidanceSimpleAffirmationSignal(message) &&
    String(sessionVariables.proofOrMediaOfferPending || '').toLowerCase() === 'true') {
    return {
      ...classification,
      primaryIntent: 'media_or_proof_request',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: deliveryLocation || classification.deliveryLocation || null,
      paymentMode: null,
      objectionType: 'trust_or_proof',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.86),
      reason: 'Fallback deterministe: confirmation courte d une offre recente de visuels, preuves ou temoignages.'
    }
  }

  if (hasGuidanceSimpleAffirmationSignal(message) &&
    previousState.currentIntent === 'delivery_or_availability_question') {
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
      confidence: Math.max(classification.confidence || 0, 0.84),
      reason: 'Fallback deterministe: acquiescement apres reponse de livraison, sans confirmation de commande.'
    }
  }

  if ((classification.primaryIntent === 'order_confirmation' || contextualOrderConfirmation) &&
    contextualOrderConfirmation &&
    knownQuantity) {
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: [],
      purchaseStage: 'order_confirmation',
      quantity: Number(knownQuantity) || knownQuantity,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence || 0, 0.88),
      reason: 'Fallback deterministe: confirmation de commande avec quantite deja connue.'
    }
  }

  const repeatedQuantity = extractGuidanceBoxQuantity(message)
  if (repeatedQuantity &&
    knownQuantity &&
    String(repeatedQuantity) === String(knownQuantity) &&
    (previousState.knownProspectInfo?.deliveryLocation || sessionVariables.knownDeliveryLocation) &&
    String(sessionVariables.orderValidationAsked || '').toLowerCase() === 'true') {
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: [],
      purchaseStage: 'order_confirmation',
      quantity: Number(knownQuantity) || knownQuantity,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence || 0, 0.88),
      reason: 'Fallback deterministe: le prospect confirme la meme quantite apres recapitulatif et lieu de livraison deja connus.'
    }
  }

  if (previousState.currentIntent === 'business_or_reseller_interest' &&
    hasGuidanceContextualBusinessPartnerFollowUpSignal(message)) {
    const shouldNotifySales = hasGuidanceExplicitBusinessPartnerHandoffSignal(message)
    return {
      ...classification,
      primaryIntent: 'business_or_reseller_interest',
      secondaryIntents: classification.primaryIntent && classification.primaryIntent !== 'business_or_reseller_interest'
        ? [classification.primaryIntent]
        : [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales,
      confidence: Math.max(classification.confidence || 0, 0.88),
      reason: shouldNotifySales
        ? 'Fallback deterministe: le prospect confirme explicitement son interet partenaire ou revendeur apres clarification.'
        : 'Fallback deterministe: le prospect poursuit la demande de renseignements business apres clarification.'
    }
  }

  if (hasGuidanceWhatsAppContactOnlySignal(message)) {
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
      confidence: Math.max(classification.confidence || 0, 0.86),
      reason: 'Fallback deterministe: le prospect demande le contact WhatsApp sans confirmer encore un interet partenaire ou une commande.'
    }
  }

  if (hasGuidanceBusinessOrResellerInterestSignal(message)) {
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
      confidence: Math.max(classification.confidence || 0, 0.86),
      reason: 'Fallback deterministe: le prospect demande a rejoindre un groupe de vente ou exprime un interet business/revendeur.'
    }
  }

  if (hasGuidanceConversationClosingSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'conversation_closing',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: Boolean(classification.medicalConcern),
      conversationClosed: true,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.86),
      reason: 'Fallback deterministe: le prospect cloture poliment la conversation.'
    }
  }

  if (hasGuidanceMedicalConcernSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'health_condition_question',
      secondaryIntents: Array.from(new Set([...(classification.secondaryIntents || []), classification.primaryIntent].filter((intent) => intent && intent !== 'health_condition_question'))),
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: 'safety_or_medical',
      medicalConcern: true,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.88),
      reason: 'Fallback deterministe: le prospect mentionne une pathologie, une guerison ou un risque medical.'
    }
  }

  if (hasGuidanceDeferralDominantSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: Array.from(new Set([...(classification.secondaryIntents || []), 'purchase_intent'].filter(Boolean))),
      purchaseStage: 'none',
      quantity: extractGuidanceBoxQuantity(message),
      deliveryLocation: null,
      paymentMode: null,
      objectionType: hasGuidanceBudgetBlockerSignal(message) ? 'price_or_budget' : 'delay_or_follow_up',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.86),
      reason: 'Fallback deterministe: le prospect temporise, evoque le budget ou indique vouloir revenir plus tard.'
    }
  }

  if (hasGuidanceDirectOrderWithoutQuantitySignal(message) &&
    !hasGuidanceMedicalConcernSignal(message) &&
    !hasGuidanceSentMessagesReviewSignal(message) &&
    !hasGuidanceDeferralDominantSignal(message)) {
    const orderedQuantity = extractGuidanceBoxQuantity(message)
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: [],
      purchaseStage: orderedQuantity ? 'quantity_selected' : 'ready_to_order',
      quantity: orderedQuantity,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence || 0, 0.78),
      reason: orderedQuantity
        ? `Fallback deterministe: le prospect commande ${orderedQuantity} boite(s).`
        : 'Fallback deterministe: le prospect veut commander sans donner de quantite.'
    }
  }

  if (hasGuidanceSoftPurchaseIntentSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: [],
      purchaseStage: 'ready_to_order',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: hasGuidancePriorSpendOrBudgetSignal(message) ? 'price_or_budget' : classification.objectionType || null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence || 0, 0.84),
      reason: 'Fallback deterministe: le prospect indique vouloir essayer les produits apres une hesitation.'
    }
  }

  if (hasGuidanceBudgetBlockerSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: deliveryLocation || classification.deliveryLocation || null,
      paymentMode: null,
      objectionType: 'price_or_budget',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.82),
      reason: 'Fallback deterministe: le prospect nomme le budget comme blocage sans demander un nouveau prix.'
    }
  }

  if (hasGuidanceSentMessagesReviewSignal(message) &&
    deliveryLocation &&
    previousState.currentIntent === 'information_request' &&
    hasSentProductMedia(sessionVariables.sentProductMedia)) {
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: [],
      purchaseStage: 'ready_to_order',
      quantity: null,
      deliveryLocation: null,
      guidanceDeliveryLocation: deliveryLocation,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: true,
      confidence: 0.78,
      reason: 'Fallback deterministe: le prospect accuse reception de la presentation, donne son pays et reste dans le flow de choix de pack.'
    }
  }

  const deferredQuantity = extractGuidanceBoxQuantity(message)
  if (deferredQuantity && hasGuidanceDelayOrFollowUpSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: Array.from(new Set([...(classification.secondaryIntents || []), 'purchase_intent'])),
      purchaseStage: 'none',
      quantity: deferredQuantity,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: 'delay_or_follow_up',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.86),
      reason: 'Fallback deterministe: le prospect indique une preference de quantite tout en reportant sa decision.'
    }
  }

  if (hasGuidanceDelayOrFollowUpSignal(message) &&
    !hasGuidanceSentMessagesReviewSignal(message) &&
    !hasGuidanceConversationClosingSignal(message)) {
    const secondaryIntentsFromPendingTopics = (previousState.pendingTopics || [])
      .map((topic) => ({
        information: 'information_request',
        price: 'price_inquiry',
        purchase: 'purchase_intent'
      })[topic])
      .filter(Boolean)

    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: uniqueList([
        ...secondaryIntentsFromPendingTopics,
        classification.primaryIntent && classification.primaryIntent !== 'follow_up_or_deferral' ? classification.primaryIntent : null
      ]),
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: 'delay_or_follow_up',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.86),
      reason: 'Fallback deterministe: le prospect indique vouloir organiser la suite ou revenir plus tard.'
    }
  }

  if (hasGuidanceHighBoxCountTreatmentQuestionSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'dosage_usage_question',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: hasGuidanceTreatmentBudgetConcernSignal(message) ? 'price_or_budget' : 'safety_or_medical',
      medicalConcern: true,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.88),
      reason: 'Fallback deterministe: le prospect demande si un nombre eleve de boites est necessaire pour un traitement.'
    }
  }

  if (hasGuidancePriceInquirySignal(message)) {
    return {
      ...classification,
      primaryIntent: 'price_inquiry',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      guidanceQuantity: extractGuidanceBoxQuantity(message),
      deliveryLocation: null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.86),
      reason: 'Fallback deterministe: le prospect pose une question de prix explicite.'
    }
  }

  if (classification?.medicalConcern && classification.primaryIntent !== 'health_condition_question' && hasGuidanceMedicalConcernSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'health_condition_question',
      secondaryIntents: Array.from(new Set([...(classification.secondaryIntents || []), classification.primaryIntent].filter(Boolean))),
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: null,
      paymentMode: null,
      objectionType: classification.objectionType || 'safety_or_medical',
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.85),
      reason: classification.reason || 'Le prospect mentionne une condition medicale ou un risque de sante.'
    }
  }

  const explicitBoxQuantityWithPack = extractGuidanceExplicitBoxQuantityWithPack(message)
  if (explicitBoxQuantityWithPack) {
    return {
      ...classification,
      primaryIntent: 'purchase_intent',
      secondaryIntents: [],
      purchaseStage: 'quantity_selected',
      quantity: explicitBoxQuantityWithPack,
      deliveryLocation: deliveryLocation || classification.deliveryLocation || null,
      paymentMode: null,
      objectionType: null,
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence || 0, 0.88),
      reason: 'Fallback deterministe: le prospect donne une quantite explicite en parlant d un pack.'
    }
  }

  if (hasGuidanceSentMessagesReviewSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'follow_up_or_deferral',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: deliveryLocation || classification.deliveryLocation || null,
      paymentMode: null,
      objectionType: 'delay_or_follow_up',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.86),
      reason: 'Fallback deterministe: le prospect demande du temps pour prendre connaissance des messages envoyes.'
    }
  }

  if (hasGuidanceGeneralDeliveryQuestionSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'delivery_or_availability_question',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: deliveryLocation || classification.deliveryLocation || null,
      paymentMode: null,
      objectionType: 'availability',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.84),
      reason: 'Fallback deterministe: le prospect pose une question generale sur la livraison.'
    }
  }

  if (hasGuidanceRepresentativeContactRequestSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'delivery_or_availability_question',
      secondaryIntents: Array.isArray(classification.secondaryIntents) ? classification.secondaryIntents : [],
      purchaseStage: classification.purchaseStage === 'order_confirmation' ? 'delivery_pending' : 'none',
      quantity: null,
      deliveryLocation: deliveryLocation || classification.deliveryLocation || null,
      paymentMode: null,
      objectionType: 'availability',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: true,
      confidence: Math.max(classification.confidence || 0, 0.84),
      reason: 'Fallback deterministe: le prospect demande le contact ou numero d un representant.'
    }
  }

  if (hasGuidanceRepresentativeAvailabilityQuestionSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'delivery_or_availability_question',
      secondaryIntents: Array.isArray(classification.secondaryIntents) ? classification.secondaryIntents : [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: deliveryLocation || classification.deliveryLocation || null,
      paymentMode: null,
      objectionType: 'availability',
      medicalConcern: false,
      conversationClosed: false,
      shouldNotifySales: false,
      confidence: Math.max(classification.confidence || 0, 0.84),
      reason: 'Fallback deterministe: le prospect demande si une representation existe dans un lieu.'
    }
  }

  if (!classifierUnavailable) {
    if (deliveryLocation && hasGuidanceResidenceLocationSignal(message)) {
      return {
        ...classification,
        primaryIntent: 'delivery_or_availability_question',
        secondaryIntents: [],
        purchaseStage: knownQuantity ? 'delivery_pending' : 'none',
        quantity: knownQuantity,
        deliveryLocation,
        paymentMode: null,
        objectionType: 'availability',
        medicalConcern: false,
        conversationClosed: false,
        shouldNotifySales: Boolean(knownQuantity),
        confidence: Math.max(classification.confidence || 0, 0.84),
        reason: 'Fallback deterministe: le prospect donne son pays ou lieu de residence pour la logistique.'
      }
    }
    if (deliveryLocation && classification.primaryIntent === 'delivery_or_availability_question') {
      return {
        ...classification,
        deliveryLocation,
        quantity: classification.quantity || knownQuantity || null,
        shouldNotifySales: classification.shouldNotifySales || Boolean(knownQuantity),
        confidence: Math.max(classification.confidence || 0, 0.84),
        reason: 'Fallback deterministe: adresse de livraison detaillee preservee depuis le message prospect.'
      }
    }
    return classification
  }

  if (!hasDeliverySignal) return classification

  return {
    ...classification,
    primaryIntent: 'delivery_or_availability_question',
    secondaryIntents: [],
    purchaseStage: knownQuantity ? 'delivery_pending' : 'none',
    quantity: knownQuantity,
    deliveryLocation,
    paymentMode: null,
    objectionType: deliveryLocation ? 'availability' : classification.objectionType || null,
    medicalConcern: false,
    conversationClosed: false,
    shouldNotifySales: Boolean(knownQuantity),
    confidence: Math.max(classification.confidence || 0, 0.82),
    reason: 'Fallback deterministe: le message contient un signal clair de lieu, disponibilite ou livraison.'
  }
}

const getTopicForIntent = (intent) => ({
  information_request: 'information',
  price_inquiry: 'price',
  purchase_intent: 'purchase',
  dosage_usage_question: 'usage',
  health_condition_question: 'medical_safety',
  product_composition_question: 'composition',
  delivery_or_availability_question: 'delivery',
  payment_question: 'payment',
  proof_testimonial_request: 'proof',
  media_or_proof_request: 'proof',
  business_or_reseller_interest: 'business_interest',
  follow_up_or_deferral: 'follow_up',
  order_confirmation: 'order_confirmation',
  conversation_closing: 'closing'
})[intent] || null

const getConversationStage = (classification = {}, previousState = {}) => {
  if (classification.conversationClosed || classification.primaryIntent === 'conversation_closing') return 'closed'
  if (classification.medicalConcern || classification.primaryIntent === 'health_condition_question') return 'safety'
  if (['order_confirmation', 'completed'].includes(classification.purchaseStage)) return 'confirmation'
  if (['quantity_needed', 'ready_to_order', 'quantity_selected', 'delivery_pending', 'payment_pending'].includes(classification.purchaseStage)) return 'purchase'
  if (classification.primaryIntent === 'follow_up_or_deferral') return 'follow_up'
  if (classification.primaryIntent && classification.primaryIntent !== 'unknown') return 'information'
  return previousState.conversationStage || 'discovery'
}

const buildConversationState = (classification = {}, sessionVariables = {}, conversation = [], previousClassification = {}) => {
  const previousState = parseSessionJson(sessionVariables.strandsConversationState, {})
  const currentTopic = getTopicForIntent(classification.primaryIntent)
  const pendingTopics = currentTopic && !['follow_up', 'closing'].includes(currentTopic)
    ? uniqueList([...(previousState.pendingTopics || []), currentTopic])
    : previousState.pendingTopics || []
  const knownProspectInfo = {
    quantity: classification.quantity || (classification.guidanceQuantity ? `${classification.guidanceQuantity}` : null) || sessionVariables.knownBoxQuantity || previousState.knownProspectInfo?.quantity || null,
    deliveryLocation: firstValidDeliveryLocation(classification.deliveryLocation, classification.guidanceDeliveryLocation, sessionVariables.knownDeliveryLocation, previousState.knownProspectInfo?.deliveryLocation),
    paymentMode: classification.paymentMode || sessionVariables.knownPaymentMode || previousState.knownProspectInfo?.paymentMode || null,
    medicalConcern: Boolean(classification.medicalConcern || previousState.knownProspectInfo?.medicalConcern),
    healthContext: uniqueList([
      ...(previousState.knownProspectInfo?.healthContext || []),
      classification.medicalConcern ? classification.reason : null
    ]).slice(-5)
  }

  return {
    conversationStage: getConversationStage(classification, previousState),
    previousIntent: previousClassification.primaryIntent || previousState.currentIntent || null,
    currentIntent: classification.primaryIntent || 'unknown',
    currentPurchaseStage: classification.purchaseStage || 'none',
    knownProspectInfo,
    answeredTopics: uniqueList(previousState.answeredTopics || []),
    pendingTopics,
    sentAssets: uniqueList([
      ...(previousState.sentAssets || []),
      sessionVariables.whatsappGroupLinkSent === 'true' ? 'whatsapp_group_link' : null,
      hasSentProductMedia(sessionVariables.sentProductMedia) ? 'product_media' : null
    ]),
    blockedActions: uniqueList([
      ...(previousState.blockedActions || []),
      classification.medicalConcern ? 'sales_push' : null,
      classification.conversationClosed ? 'automatic_follow_up' : null
    ]),
    recentTurnCount: Array.isArray(conversation) ? conversation.length : 0
  }
}

const buildResponsePolicy = (classification = {}, conversationState = {}, sessionVariables = {}) => {
  const currentTopic = getTopicForIntent(classification.primaryIntent)
  const secondaryTopics = Array.isArray(classification.secondaryIntents)
    ? classification.secondaryIntents.map(getTopicForIntent).filter(Boolean)
    : []
  const mustAvoid = ['medical_claims']
  const mustNotRepeat = []

  if (classification.medicalConcern || conversationState.knownProspectInfo?.medicalConcern) mustAvoid.push('sales_push')
  if (classification.primaryIntent === 'unknown') mustAvoid.push('sales_push')
  if (classification.primaryIntent === 'follow_up_or_deferral') mustAvoid.push('sales_push')
  if (classification.primaryIntent === 'business_or_reseller_interest') mustAvoid.push('sales_push')
  if (classification.primaryIntent === 'dosage_usage_question') mustAvoid.push('sales_push')
  if (classification.primaryIntent === 'product_composition_question' && (conversationState.previousIntent === 'follow_up_or_deferral' || conversationState.knownProspectInfo?.quantity)) mustAvoid.push('sales_push')
  if (classification.primaryIntent === 'price_inquiry' && classification.secondaryIntents?.includes('product_composition_question')) mustAvoid.push('sales_push')
  if (sessionVariables.productPresentationPackChoiceResponseSent === 'true') mustNotRepeat.push('product_presentation_pack_choice')
  if (sessionVariables.priceObjectionResponseSent === 'true') mustNotRepeat.push('price_objection_argument')
  if (classification.primaryIntent === 'purchase_intent' && ['price_or_budget', 'price_high'].includes(classification.objectionType)) mustNotRepeat.push('price_objection_argument')
  if (conversationState.knownProspectInfo?.quantity && classification.primaryIntent !== 'price_inquiry') mustNotRepeat.push('ask_quantity')
  if (conversationState.knownProspectInfo?.deliveryLocation) mustNotRepeat.push('ask_delivery_location')
  if (conversationState.knownProspectInfo?.paymentMode) mustNotRepeat.push('ask_payment_mode')
  if (classification.primaryIntent === 'follow_up_or_deferral') mustNotRepeat.push('ask_delivery_location')
  if (classification.primaryIntent === 'media_or_proof_request') mustNotRepeat.push('ask_quantity')
  if (classification.primaryIntent === 'follow_up_or_deferral' &&
    /deja\s+repondu|sans\s+repeter/i.test(classification.reason || '') &&
    conversationState.knownProspectInfo?.quantity &&
    conversationState.knownProspectInfo?.deliveryLocation) {
    mustNotRepeat.push('ask_payment_mode')
  }
  if (conversationState.sentAssets?.includes('whatsapp_group_link')) mustNotRepeat.push('whatsapp_group_link')
  if (conversationState.sentAssets?.includes('product_media')) mustNotRepeat.push('product_media')

  const nextBestActionByIntent = {
    information_request: 'answer_information_then_resume_sales_flow',
    price_inquiry: 'answer_price_directly_then_one_soft_next_question',
    purchase_intent: classification.purchaseStage === 'quantity_needed'
      ? 'ask_quantity_before_payment_or_delivery'
      : classification.purchaseStage === 'order_confirmation'
        ? 'confirm_order_and_collect_missing_payment_or_delivery_detail'
        : 'confirm_pack_or_quantity_without_repeating_full_pitch',
    dosage_usage_question: 'answer_usage_precisely_before_any_sales_question',
    health_condition_question: 'give_medical_safety_response_without_sales_push',
    product_composition_question: 'answer_composition_without_inventing',
    delivery_or_availability_question: 'answer_delivery_or_availability_before_sales_question',
    payment_question: 'answer_payment_options_and_include_link_only_when_quantity_is_clear',
    proof_testimonial_request: 'send_or_offer_proof_without_repeating_prior_media',
    media_or_proof_request: 'send_requested_media_or_proof_without_repeating_full_pitch',
    business_or_reseller_interest: 'clarify_business_or_reseller_interest_without_forcing_order',
    follow_up_or_deferral: 'acknowledge_deferral_and_ask_one_blocker_only',
    order_confirmation: 'acknowledge_confirmation_and_continue_to_missing_order_detail',
    conversation_closing: 'close_politely_without_relaunch',
    unknown: 'answer_latest_message_directly_and_avoid_repetition'
  }

  return {
    mustAnswer: uniqueList([
      currentTopic,
      ...secondaryTopics,
      classification.primaryIntent === 'price_inquiry' && classification.secondaryIntents?.includes('product_composition_question') ? 'usage' : null,
      classification.objectionType === 'price_or_budget' && classification.primaryIntent !== 'follow_up_or_deferral' ? 'price' : null
    ]),
    mustNotRepeat: uniqueList(mustNotRepeat),
    mustAvoid: uniqueList(mustAvoid),
    tone: 'short_whatsapp_friendly',
    nextBestAction: classification.primaryIntent === 'health_condition_question'
      ? nextBestActionByIntent.health_condition_question
      : classification.primaryIntent === 'follow_up_or_deferral' && /deja\s+repondu|sans\s+repeter/i.test(classification.reason || '')
        ? nextBestActionByIntent.unknown
        : nextBestActionByIntent[classification.primaryIntent] || nextBestActionByIntent.unknown,
    confidence: classification.confidence || 0
  }
}

const buildRecipient = (testCase, turn, index) => ({
  messageBody: turn.message,
  channel: testCase.channel || 'whatsapp',
  destinationAddress: testCase.destinationAddress || '+2250000000000',
  serviceAddress: testCase.serviceAddress || '+2250701073000',
  senderName: testCase.senderName || 'Evaluation Prospect',
  inboundMessageId: `${testCase.id}-turn-${index + 1}`
})

const invokeLambda = async (lambdaClient, lambdaName, payload) => {
  const command = new InvokeCommand({
    FunctionName: lambdaName,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify(payload))
  })
  const response = await lambdaClient.send(command)
  const payloadText = Buffer.from(response.Payload || []).toString('utf8')
  const parsedPayload = payloadText ? JSON.parse(payloadText) : {}

  if (response.FunctionError) {
    throw new Error(`Lambda returned ${response.FunctionError}: ${payloadText}`)
  }

  return parsedPayload
}

const invokeClassifier = async (lambdaClient, lambdaName, payload) => {
  const response = await invokeLambda(lambdaClient, lambdaName, payload)
  return response.classification || response
}

const invokeResponseGenerator = async (lambdaClient, lambdaName, payload) => {
  return invokeLambda(lambdaClient, lambdaName, payload)
}

const getValue = (object, path) => path.split('.').reduce((value, key) => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
    value = parseSessionJson(value, value)
  }
  return value?.[key]
}, object)

const valuesMatch = (actual, expected) => {
  if (expected === null) return actual === null || actual === undefined
  if (Array.isArray(expected)) {
    if (Array.isArray(actual)) return expected.every((expectedItem) => actual.includes(expectedItem))
    return expected.includes(actual)
  }
  return actual === expected
}

const compareObject = (actual = {}, expected = {}, prefix = '') => {
  const failures = []

  for (const [path, expectedValue] of Object.entries(expected || {})) {
    const actualValue = getValue(actual, path)
    if (!valuesMatch(actualValue, expectedValue)) {
      failures.push({
        path: prefix ? `${prefix}.${path}` : path,
        expected: expectedValue,
        actual: actualValue
      })
    }
  }

  return failures
}

const includesNormalized = (text, pattern) => normalizeText(text).includes(normalizeText(pattern))

const splitSentences = (text = '') => String(text || '')
  .split(/(?<=[.!?])\s+/)
  .map((sentence) => sentence.trim())
  .filter((sentence) => sentence.length >= 24)

const countRepeatedSentences = (previousAssistantMessage = '', currentResponse = '') => {
  const current = normalizeText(currentResponse)
  return splitSentences(previousAssistantMessage)
    .filter((sentence) => current.includes(normalizeText(sentence)))
    .length
}

const compareResponse = (response = '', expected = {}, previousAssistantMessage = '') => {
  const failures = []

  if (expected.exact !== undefined && response !== expected.exact) {
    failures.push({ path: 'response.exact', expected: expected.exact, actual: response })
  }

  for (const pattern of expected.mustInclude || []) {
    if (!includesNormalized(response, pattern)) {
      failures.push({ path: 'response.mustInclude', expected: pattern, actual: response })
    }
  }

  for (const pattern of expected.mustExclude || []) {
    if (includesNormalized(response, pattern)) {
      failures.push({ path: 'response.mustExclude', expected: `not ${pattern}`, actual: response })
    }
  }

  if (Number.isInteger(expected.maxRepeatedSentencesFromPreviousAssistant)) {
    const repeatedCount = countRepeatedSentences(previousAssistantMessage, response)
    if (repeatedCount > expected.maxRepeatedSentencesFromPreviousAssistant) {
      failures.push({
        path: 'response.maxRepeatedSentencesFromPreviousAssistant',
        expected: expected.maxRepeatedSentencesFromPreviousAssistant,
        actual: repeatedCount
      })
    }
  }

  return failures
}

const compareSessionVariables = (sessionVariables = {}, expected = {}) => {
  const failures = []

  if (expected.jsonContains) {
    failures.push(...compareObject(sessionVariables, expected.jsonContains, 'sessionVariables.jsonContains'))
  }

  if (expected.mustHave) {
    for (const path of expected.mustHave) {
      const actual = getValue(sessionVariables, path)
      if (actual === undefined || actual === null || actual === '') {
        failures.push({ path: `sessionVariables.mustHave.${path}`, expected: 'present', actual })
      }
    }
  }

  if (expected.mustEqual) {
    failures.push(...compareObject(sessionVariables, expected.mustEqual, 'sessionVariables.mustEqual'))
  }

  return failures
}

const writeReport = (outputFile, report) => {
  mkdirSync(dirname(outputFile), { recursive: true })
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

const runTurn = async ({ lambdaClient, args, useCase, testCase, turn, turnIndex, conversation, sessionVariables, previousAssistantMessage }) => {
  const recipient = buildRecipient(testCase, turn, turnIndex)
  const classifierPayload = { useCase, recipient, conversation, sessionVariables }
  const previousClassification = parseSessionJson(sessionVariables.strandsIntentClassification, {})
  const classification = applyGuidanceClassificationFallback(
    await invokeClassifier(lambdaClient, args.classifierLambdaName, classifierPayload),
    recipient.messageBody,
    sessionVariables
  )
  const classifiedSessionVariables = {
    ...sessionVariables,
    strandsIntentClassification: JSON.stringify(classification),
    strandsIntentClassificationSource: 'strands-intent-classifier',
    strandsIntentClassificationAt: new Date().toISOString()
  }
  const conversationState = buildConversationState(classification, classifiedSessionVariables, conversation, previousClassification)
  const responsePolicy = buildResponsePolicy(classification, conversationState, classifiedSessionVariables)
  const guidedSessionVariables = {
    ...classifiedSessionVariables,
    strandsConversationState: JSON.stringify(conversationState),
    strandsResponsePolicy: JSON.stringify(responsePolicy)
  }

  const responseGeneratorPayload = {
    useCase,
    recipient,
    conversation,
    sessionVariables: guidedSessionVariables
  }
  const generatorResponse = await invokeResponseGenerator(lambdaClient, args.responseGeneratorLambdaName, responseGeneratorPayload)
  const response = generatorResponse.response || ''
  const nextSessionVariables = {
    ...guidedSessionVariables,
    ...(generatorResponse.sessionVariables || {}),
    ...(generatorResponse.llmSessionId ? { llmSessionId: generatorResponse.llmSessionId } : {})
  }

  const expected = turn.expected || {}
  const failures = [
    ...compareObject(classification, expected.classification || {}, 'classification'),
    ...compareObject(responsePolicy, expected.policy || {}, 'policy'),
    ...compareResponse(response, expected.response || {}, previousAssistantMessage),
    ...compareSessionVariables(nextSessionVariables, expected.sessionVariables || {})
  ]

  return {
    passed: failures.length === 0,
    failures,
    classification,
    conversationState,
    responsePolicy,
    response,
    source: generatorResponse.source,
    sessionVariables: nextSessionVariables
  }
}

const run = async () => {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  if (!args.classifierLambdaName) throw new Error('Missing --classifier-lambda-name or STRANDS_INTENT_CLASSIFIER_LAMBDA_NAME.')
  if (!args.responseGeneratorLambdaName) throw new Error('Missing --response-generator-lambda-name or AGENT_RESPONSE_GENERATOR_LAMBDA_NAME.')

  const cases = loadCases(args.casesFile)
  const useCase = loadUseCase(args.useCaseFile)
  const lambdaClient = new LambdaClient({ region: args.region })
  const caseResults = []

  console.log(`Evaluating ${cases.length} multi-turn conversation case(s) in ${args.region}.`)
  console.log(`Classifier Lambda: ${args.classifierLambdaName}`)
  console.log(`Response Generator Lambda: ${args.responseGeneratorLambdaName}`)
  console.log(`Cases: ${args.casesFile}`)

  for (const testCase of cases) {
    const conversation = [...(testCase.initialConversation || [])]
    let sessionVariables = {
      useCaseId: useCase.useCase || 'agent',
      channel: testCase.channel || 'whatsapp',
      sessionId: testCase.sessionId || `conversation-evaluation-${testCase.id}`,
      evaluationMode: 'true',
      ...(testCase.sessionVariables || {})
    }
    let previousAssistantMessage = ''
    const turnResults = []

    console.log('')
    console.log(`Case ${testCase.id}: ${testCase.description || ''}`.trim())

    for (let turnIndex = 0; turnIndex < testCase.turns.length; turnIndex += 1) {
      const turn = testCase.turns[turnIndex]

      try {
        const turnResult = await runTurn({
          lambdaClient,
          args,
          useCase,
          testCase,
          turn,
          turnIndex,
          conversation,
          sessionVariables,
          previousAssistantMessage
        })
        turnResults.push({
          index: turnIndex + 1,
          message: turn.message,
          ...turnResult
        })

        const status = turnResult.passed ? 'PASS' : 'FAIL'
        console.log(`${status} turn ${turnIndex + 1}: ${turn.message}`)
        console.log(`  intent=${turnResult.classification.primaryIntent}, nextBestAction=${turnResult.responsePolicy.nextBestAction}`)

        for (const failure of turnResult.failures) {
          console.log(`  mismatch ${failure.path}: expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`)
        }

        conversation.push({
          direction: 'inbound',
          message: turn.message,
          sessionVariables: turnResult.sessionVariables
        })
        conversation.push({
          direction: 'outbound',
          message: turnResult.response,
          sessionVariables: turnResult.sessionVariables
        })
        sessionVariables = turnResult.sessionVariables
        previousAssistantMessage = turnResult.response

        if (!turnResult.passed && args.failFast) break
      } catch (error) {
        const errorResult = {
          index: turnIndex + 1,
          message: turn.message,
          passed: false,
          failures: [{ path: 'turn', expected: 'success', actual: error.message }],
          error: error.message
        }
        turnResults.push(errorResult)
        console.log(`ERROR turn ${turnIndex + 1}: ${error.message}`)
        if (args.failFast) break
      }
    }

    caseResults.push({
      id: testCase.id,
      description: testCase.description,
      passed: turnResults.every((result) => result.passed),
      turns: turnResults
    })

    if (!caseResults.at(-1).passed && args.failFast) break
  }

  const totalTurns = caseResults.reduce((count, result) => count + result.turns.length, 0)
  const passedTurns = caseResults.reduce((count, result) => count + result.turns.filter((turn) => turn.passed).length, 0)
  const failedTurns = totalTurns - passedTurns
  const passedCases = caseResults.filter((result) => result.passed).length
  const reliability = totalTurns ? (passedTurns / totalTurns) * 100 : 0
  const report = {
    generatedAt: new Date().toISOString(),
    classifierLambdaName: args.classifierLambdaName,
    responseGeneratorLambdaName: args.responseGeneratorLambdaName,
    region: args.region,
    casesFile: args.casesFile,
    summary: {
      totalCases: caseResults.length,
      passedCases,
      failedCases: caseResults.length - passedCases,
      totalTurns,
      passedTurns,
      failedTurns,
      reliability
    },
    results: caseResults
  }

  console.log('')
  console.log(`Summary: ${passedTurns}/${totalTurns} turns passed (${reliability.toFixed(1)}%).`)
  writeReport(args.outputFile, report)
  console.log(`Report written to ${args.outputFile}`)

  if (failedTurns > 0) process.exitCode = 1
}

run().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
