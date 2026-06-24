// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

import { randomUUID } from 'crypto';

// SPDX-License-Identifier: MIT-0
const DynamoDBService = require('./services/DynamoDBService.mjs');
const FirehoseService = require('./services/FirehoseService.mjs');
const LambdaService = require('./services/LambdaService.mjs');
const MessageComplianceService = require('./services/MessageComplianceService.mjs');
const xss = require("xss") //https://github.com/leizongmin/js-xss
const Cache = require('./services/CacheService.js');
// Initialize cache
const cache = new Cache();

const PROSPECT_SESSION_FIELDS = [
  'ctwa_clid'
]

const getProspectSessionVariables = (recipient = {}) => {
  const sources = [
    recipient,
    recipient.prospect,
    recipient.metadata,
    recipient.tracking
  ].filter(Boolean)

  return PROSPECT_SESSION_FIELDS.reduce((variables, field) => {
    const value = sources.find(source => source[field] !== undefined && source[field] !== null)?.[field]
    if (value !== undefined && value !== null && String(value).trim()) {
      variables[field] = String(value)
    }
    return variables
  }, {})
}

const writeMessageToStorage = async (recipient, direction, channel, messageContent, messageId, sessionId = null, sessionVariables = {}) => {
  // Write to DynamoDB
  const dbParams = {
    phoneNumber: recipient.destinationAddress,
    messageId: messageId,
    channel: channel,
    timestamp: Date.now(),
    message: xss(messageContent),
    serviceAddress: recipient.serviceAddress,
    direction: direction,
    previousPublishedMessageId: recipient.previousPublishedMessageId,
    sessionId: sessionId,
    sessionVariables: sessionVariables,
    ttl: (Date.now() / 1000) + parseInt(process.env.SESSION_SECONDS)
  }
  console.trace(dbParams)
  const putResults = await DynamoDBService.put(process.env.CONTEXT_DYNAMODB_TABLE, dbParams);
  console.debug(`put${direction}Results: `, putResults);

  // Write to Firehose if configured
  if (process.env.CONVERSATION_FIREHOSE_STREAM) {
    const firehoseParams = {
      accountId: process.env.ACCOUNT_ID,
      organizationId: process.env.ORGANIZATION_ID,
      messageId: messageId,
      serviceAddress: recipient.serviceAddress,
      destinationAddress: recipient.destinationAddress,
      channel: channel,
      direction: direction,
      sessionId: sessionId,
      sessionVariables: sessionVariables,
      timestamp: Date.now(),
      tags: {},
      message: messageContent
    }
    await FirehoseService.firehoseDirectPut(process.env.CONVERSATION_FIREHOSE_STREAM, firehoseParams);
  }
}

const sendResponse = async (useCase, recipient, inboundMessage, outboundMessage, imageId = null, sessionId, sessionVariables = {}) => {
  let channel = []
  if (sessionVariables.channel && !sessionVariables.channel.toLowerCase().startsWith('api')) {
    //find the channel in the usecase that matches the recipient channel
    channel = useCase.channels.find(channel => channel.channel === sessionVariables.channel)
  } else {
    channel.channel = sessionVariables.channel || 'API'
  }

  let response = { 'message': 'No channel processor response generated.',
    'messageId': randomUUID()
  }

  if(!channel.channel.toLowerCase().startsWith('api')){
    if(imageId){
      response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, outboundMessage, imageId})
    } else {
      response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, outboundMessage})
    }
  }

  console.log('Response: ', JSON.stringify(response, null, 2))

  // Return data needed for storage operations in main handler
  return {
    channel: channel.channel,
    response: response,
    inboundMessage: inboundMessage,
    outboundMessage: outboundMessage,
    sessionId: sessionId,
    sessionVariables: sessionVariables
  }
}

const mergeResponseSessionVariables = (sessionVariables = {}, generatorResponse = {}) => {
  return {
    ...sessionVariables,
    ...(generatorResponse.sessionVariables || {}),
    ...(generatorResponse.llmSessionId ? {llmSessionId: generatorResponse.llmSessionId} : {})
  }
}

const isOrderConfirmed = (sessionVariables = {}) => {
  return String(sessionVariables.orderConfirmed || '').toLowerCase() === 'true'
}

const normalizeConversationClosingText = (value = '') => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const hasConversationClosingPhrase = (message = '') => {
  const value = normalizeConversationClosingText(message)
  return /\b(?:a bientot|au revoir|bye|goodbye|bonne journee|bonne soiree|bonne continuation|a la prochaine|merci et bonne journee|merci et bonne soiree)\b/.test(value)
}

const isConversationClosedByAgent = (sessionVariables = {}) => {
  return String(sessionVariables.conversationClosed || '').toLowerCase() === 'true'
}

const hasPriorAgentClosingMessage = (conversation = []) => {
  if (!Array.isArray(conversation)) return false

  const lastOutbound = [...conversation]
    .reverse()
    .find((conversationMessage) => conversationMessage.direction === 'outbound')

  return hasConversationClosingPhrase(lastOutbound?.message)
}

const normalizeIntentFallbackText = (value = '') => {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const parseJsonList = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch (_error) {
    return []
  }
}

const buildPurchaseIntentFallbackSignature = (intentStage, message = '') => {
  return `${intentStage}:${normalizeIntentFallbackText(message).slice(0, 160)}`
}

const hasExplicitOrderConfirmationFallback = (message = '') => {
  const value = normalizeIntentFallbackText(message)
  return /\b(?:je\s+)?(?:confirme|valide)\b.{0,50}\b(?:commande|achat|pack|boite|boites|cure)\b/.test(value) ||
    /\b(?:commande|achat|pack|boite|boites|cure)\b.{0,50}\b(?:confirme|confirmee|valide|validee|ok|bon)\b/.test(value)
}

const hasSimpleConfirmationFallback = (message = '') => {
  const value = normalizeIntentFallbackText(message)
  return /\b(?:oui|ok|okay|daccord|d accord|c est bon|cest bon|je confirme|je valide|valide)\b/.test(value)
}

const hasRecentOrderConfirmationRequest = (conversation = []) => {
  if (!Array.isArray(conversation)) return false

  return conversation
    .filter((conversationMessage) => conversationMessage.direction === 'outbound')
    .slice(-3)
    .some((conversationMessage) => {
      const message = normalizeIntentFallbackText(conversationMessage.message || '')
      return /\b(?:confirmez|confirmer|confirmation|vous confirmez|puis je confirmer|validez|valider)\b/.test(message) ||
        /\b(?:valide|confirme).{0,40}\bcommande\b/.test(message)
    })
}

const hasCompleteContactDetailsFromSession = (sessionVariables = {}) => {
  return Boolean(sessionVariables.knownContactName) &&
    Boolean(sessionVariables.knownContactEmail) &&
    Boolean(sessionVariables.knownContactPhone)
}

const hasProspectConfirmedOrder = (sessionVariables = {}) => {
  return String(sessionVariables.prospectConfirmedOrder || '').toLowerCase() === 'true' ||
    isOrderConfirmed(sessionVariables)
}

const buildConfirmedOrderSummary = (sessionVariables = {}) => {
  return [
    'COMMANDE CONFIRMEE - coordonnees du prospect:',
    `Nom et prenom: ${sessionVariables.knownContactName || 'non fourni'}`,
    `E-mail: ${sessionVariables.knownContactEmail || 'non fourni'}`,
    `Telephone: ${sessionVariables.knownContactPhone || 'non fourni'}`,
    `Lieu de livraison: ${sessionVariables.knownDeliveryLocation || 'non fourni'}`,
    `Quantite: ${sessionVariables.knownBoxQuantity || 'non fourni'} boite(s)`,
    `Paiement: ${sessionVariables.knownPaymentMode || 'a preciser'}`
  ].join(' | ')
}

const detectPurchaseIntentFallback = (recipient = {}, previousSessionVariables = {}, updatedSessionVariables = {}, conversation = []) => {
  const message = recipient.messageBody || ''
  const value = normalizeIntentFallbackText(message)
  const deliveryLocationKnown = Boolean(updatedSessionVariables.knownDeliveryLocation)
  const contactDetailsComplete = hasCompleteContactDetailsFromSession(updatedSessionVariables)

  // Notification enrichie: commande confirmee + lieu de livraison connu + coordonnees completes.
  // C'est la seule alerte qui porte les coordonnees du prospect (signature stable par e-mail).
  if (hasProspectConfirmedOrder(updatedSessionVariables) && deliveryLocationKnown && contactDetailsComplete) {
    return {
      intentStage: 'order_confirmed',
      orderIntentSummary: buildConfirmedOrderSummary(updatedSessionVariables),
      signature: `order_confirmed:${updatedSessionVariables.knownContactEmail}`
    }
  }

  if ((isOrderConfirmed(updatedSessionVariables) && !isOrderConfirmed(previousSessionVariables)) ||
    hasExplicitOrderConfirmationFallback(message) ||
    (hasSimpleConfirmationFallback(message) && hasRecentOrderConfirmationRequest(conversation))) {
    // Si le lieu est connu mais les coordonnees pas encore completes, on attend: la notification
    // enrichie (avec coordonnees) sera envoyee une fois les coordonnees recues.
    if (deliveryLocationKnown && !contactDetailsComplete) return null
    return {
      intentStage: 'order_confirmation',
      orderIntentSummary: `Confirmation explicite de commande. Message prospect: ${message}`
    }
  }

  if (/\b(?:je\s+)?(?:prends?|veux|souhaite|commande|confirme|valide).{0,35}\b(?:1|une?|2|deux)\s*(?:boites?|boite|packs?|cures?)\b/.test(value) ||
    /\b(?:1|une?|2|deux)\s*(?:boites?|boite|packs?|cures?)\s*(?:svp|s'il vous plait|stp)?\b/.test(value)) {
    return {
      intentStage: 'quantity_selected',
      orderIntentSummary: `Quantité sélectionnée. Message prospect: ${message}`
    }
  }

  if (/\b(?:je\s+)?(?:veux|souhaite|vais)\s+(?:commander|acheter|prendre|reserver|faire\s+la\s+cure)\b/.test(value) ||
    /\b(?:je\s+)?(?:commande|prends?|achete|reserve)\b/.test(value)) {
    return {
      intentStage: 'ready_to_order',
      orderIntentSummary: `Prospect prêt à commander. Message prospect: ${message}`
    }
  }

  return null
}

const buildPurchaseIntentAlertEvent = (recipient = {}, sessionVariables = {}, fallback = {}) => {
  const customerName = sessionVariables.knownContactName || recipient.senderName || sessionVariables.name || 'non fourni'
  const whatsappNumber = recipient.destinationAddress || sessionVariables.whatsappNumber || sessionVariables.phoneNumber || 'non fourni'
  const contactEmail = sessionVariables.knownContactEmail || 'non fourni'
  const contactPhone = sessionVariables.knownContactPhone || whatsappNumber
  const deliveryLocation = sessionVariables.knownDeliveryLocation || 'non fourni'
  const boxQuantity = sessionVariables.knownBoxQuantity || 'non fourni'
  const paymentMode = sessionVariables.knownPaymentMode || 'non fourni'

  return {
    messageVersion: '1.0',
    sessionId: sessionVariables.llmSessionId || sessionVariables.sessionId,
    actionGroup: 'PurchaseIntentActions',
    function: 'notifyPurchaseIntent',
    sessionAttributes: {
      name: customerName,
      whatsappNumber,
      phoneNumber: whatsappNumber
    },
    promptSessionAttributes: {
      name: customerName,
      whatsappNumber,
      phoneNumber: whatsappNumber
    },
    parameters: [
      { name: 'whatsappNumber', value: whatsappNumber },
      { name: 'customerName', value: customerName },
      { name: 'contactEmail', value: contactEmail },
      { name: 'contactPhone', value: contactPhone },
      { name: 'deliveryLocation', value: deliveryLocation },
      { name: 'boxQuantity', value: `${boxQuantity}` },
      { name: 'paymentMode', value: paymentMode },
      { name: 'userMessage', value: recipient.messageBody || 'non fourni' },
      { name: 'orderIntentSummary', value: fallback.orderIntentSummary || 'Intention d achat détectée par fallback déterministe.' },
      { name: 'intentStage', value: fallback.intentStage || 'ready_to_order' }
    ]
  }
}

const maybeInvokePurchaseIntentAlertFallback = async (recipient = {}, previousSessionVariables = {}, updatedSessionVariables = {}, conversation = []) => {
  if (!process.env.PURCHASE_INTENT_ALERT_LAMBDA_NAME) return updatedSessionVariables

  const fallback = detectPurchaseIntentFallback(recipient, previousSessionVariables, updatedSessionVariables, conversation)
  if (!fallback) return updatedSessionVariables

  const signature = fallback.signature || buildPurchaseIntentFallbackSignature(fallback.intentStage, recipient.messageBody)
  const previousSignatures = parseJsonList(updatedSessionVariables.purchaseIntentFallbackAlertSignatures)
  if (previousSignatures.includes(signature)) return updatedSessionVariables

  try {
    const alertResponse = await LambdaService.invoke(
      process.env.PURCHASE_INTENT_ALERT_LAMBDA_NAME,
      buildPurchaseIntentAlertEvent(recipient, updatedSessionVariables, fallback)
    )
    const responseBody = alertResponse?.response?.functionResponse?.responseBody?.TEXT?.body
    const parsedBody = responseBody ? JSON.parse(responseBody) : {}

    if (!parsedBody.success) {
      console.warn('Purchase intent fallback alert Lambda returned a non-success response.', {
        destinationAddress: recipient.destinationAddress,
        intentStage: fallback.intentStage,
        responseBody: parsedBody
      })
      return updatedSessionVariables
    }

    console.info('Purchase intent fallback alert Lambda invoked successfully.', {
      destinationAddress: recipient.destinationAddress,
      intentStage: fallback.intentStage,
      messageId: parsedBody.messageId,
      duplicate: Boolean(parsedBody.duplicate)
    })

    return {
      ...updatedSessionVariables,
      purchaseIntentFallbackAlertSignatures: JSON.stringify([...previousSignatures, signature].slice(-20)),
      purchaseIntentFallbackAlertSentAt: new Date().toISOString()
    }
  } catch (error) {
    console.error('Purchase intent fallback alert Lambda invocation failed.', {
      destinationAddress: recipient.destinationAddress,
      intentStage: fallback.intentStage,
      errorName: error.name,
      errorMessage: error.message
    })
    return updatedSessionVariables
  }
}

const maybeInvokeStrandsIntentClassifier = async (useCase = {}, recipient = {}, conversation = [], sessionVariables = {}) => {
  if (!process.env.STRANDS_INTENT_CLASSIFIER_LAMBDA_NAME) return sessionVariables

  try {
    const classifierResponse = await LambdaService.invoke(
      process.env.STRANDS_INTENT_CLASSIFIER_LAMBDA_NAME,
      {
        useCase,
        recipient,
        conversation,
        sessionVariables
      }
    )

    const classification = classifierResponse?.classification
    if (!classification) return sessionVariables

    console.info('Strands intent classifier shadow result.', {
      destinationAddress: recipient.destinationAddress,
      sessionId: sessionVariables.sessionId,
      primaryIntent: classification.primaryIntent,
      purchaseStage: classification.purchaseStage,
      shouldNotifySales: classification.shouldNotifySales,
      confidence: classification.confidence
    })

    return {
      ...sessionVariables,
      strandsIntentClassification: JSON.stringify(classification),
      strandsIntentClassificationSource: classifierResponse.source || 'strands-intent-classifier',
      strandsIntentClassificationAt: new Date().toISOString()
    }
  } catch (error) {
    console.error('Strands intent classifier shadow invocation failed.', {
      destinationAddress: recipient.destinationAddress,
      sessionId: sessionVariables.sessionId,
      errorName: error.name,
      errorMessage: error.message
    })

    return sessionVariables
  }
}

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
    !/\b(?:ce sujet|sujet|temps|combien|question|message|propos|produits?|traitement|traiter|efficacement|boites?|paquets?|packs?|sachets?|poudre|myomes?|fibromes?|ulceres?|buruli|glycemie|diabete|arthrose|pathologie|maladie|gueri|guerit|guerir|disparaitre|disparait|aider|argent|budget|moyens|enfants?|famille|cet effet|livraison certainement|a la livraison|reduction|vente|commande|commander|achete|acheter|prendre|confirme|confirmer|valide|valider|bientot|incessamment|interesse|interessee|reveni?r|reviendrai)\b/.test(normalizedValue)
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
    /\b(?:guerir|gueri|guerit|soigne|traiter|disparaitre|disparait|disparaitre|disparait)\b/.test(value) ||
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

  if (hasGuidanceConversationClosingSignal(message)) {
    return {
      ...classification,
      primaryIntent: 'conversation_closing',
      secondaryIntents: [],
      purchaseStage: 'none',
      quantity: null,
      deliveryLocation: deliveryLocation || classification.deliveryLocation || null,
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
      deliveryLocation: null,
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

const enrichSessionWithStrandsConversationGuidance = async (useCase = {}, recipient = {}, conversation = [], sessionVariables = {}) => {
  const previousClassification = parseSessionJson(sessionVariables.strandsIntentClassification, {})
  const classifiedSessionVariables = await maybeInvokeStrandsIntentClassifier(useCase, recipient, conversation, sessionVariables)
  const rawClassification = parseSessionJson(classifiedSessionVariables.strandsIntentClassification, null)
  const classification = applyGuidanceClassificationFallback(rawClassification, recipient.messageBody, classifiedSessionVariables)

  if (!classification) return classifiedSessionVariables
  const guidedClassificationSessionVariables = {
    ...classifiedSessionVariables,
    strandsIntentClassification: JSON.stringify(classification)
  }

  const conversationState = buildConversationState(classification, guidedClassificationSessionVariables, conversation, previousClassification)
  const responsePolicy = buildResponsePolicy(classification, conversationState, guidedClassificationSessionVariables)

  console.info('Strands conversation guidance prepared.', {
    destinationAddress: recipient.destinationAddress,
    sessionId: classifiedSessionVariables.sessionId,
    currentIntent: conversationState.currentIntent,
    nextBestAction: responsePolicy.nextBestAction,
    mustNotRepeat: responsePolicy.mustNotRepeat
  })

  return {
    ...guidedClassificationSessionVariables,
    strandsConversationState: JSON.stringify(conversationState),
    strandsResponsePolicy: JSON.stringify(responsePolicy)
  }
}

const getConversation = async (phoneNumber, channel) => {
  try {
    let params = {
      TableName : process.env.CONTEXT_DYNAMODB_TABLE,
      IndexName: "PhoneIndex",
      KeyConditionExpression: "phoneNumber = :phoneNumber",
      FilterExpression: "channel = :channel",
      ExpressionAttributeValues: {
        ":phoneNumber": phoneNumber,
        ":channel": channel
      }
    }
    const getConversationResults = await DynamoDBService.query(params);
    console.debug('Get Conversation Results: ', getConversationResults);
    console.debug(JSON.stringify(getConversationResults, null, 2))
    console.debug(getConversationResults.length)
    return getConversationResults
  }
  catch (error) {
    console.error(error);
    return false
  }

}

//Forward the message as is to the recipient
const forwardMessage = async (recipient, message, useCase, imageId = null) => {

  //find the channel in the usecase that matches the recipient channel
  let channel = useCase.channels.find(channel => channel.channel === recipient.channel)

  //Call the channel processor lambda
  let response = null
  if(imageId){
    response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, "outboundMessage": message, "imageId": imageId})
  } else {
    response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, "outboundMessage": message})
  }

  console.trace('Response: ', JSON.stringify(response,null,2));

  // Return data needed for storage operations in main handler
  let sessionId = randomUUID()
  return {
    responseMessage: message,
    outboundMessageId: response.messageId,
    sessionId: sessionId,
    sessionVariables: {
      useCaseId: useCase.useCase,
      channel: recipient.channel,
      sessionId: sessionId,
      ...getProspectSessionVariables(recipient)
    }
  }
}

const processMessage = async (useCases, recipient, message) => {
  let responseMessage = null
  const existingConversation = await getConversation(recipient.destinationAddress, recipient.channel)
  const latestSessionVariables = Array.isArray(existingConversation)
    ? existingConversation[existingConversation.length - 1]?.sessionVariables || {}
    : {}

  if (isOrderConfirmed(latestSessionVariables)) {
    console.info('Order already confirmed; suppressing automatic outbound response.', {
      destinationAddress: recipient.destinationAddress,
      sessionId: latestSessionVariables.sessionId
    })
    return {
      responseMessage: null,
      outboundMessage: null,
      outboundMessageId: null,
      sessionId: latestSessionVariables.sessionId,
      sessionVariables: latestSessionVariables,
      suppressOutbound: true
    }
  }

  if (isConversationClosedByAgent(latestSessionVariables) || hasPriorAgentClosingMessage(existingConversation)) {
    console.info('Conversation already closed by agent; suppressing automatic outbound response.', {
      destinationAddress: recipient.destinationAddress,
      sessionId: latestSessionVariables.sessionId
    })
    return {
      responseMessage: null,
      outboundMessage: null,
      outboundMessageId: null,
      sessionId: latestSessionVariables.sessionId,
      sessionVariables: {
        ...latestSessionVariables,
        conversationClosed: 'true',
        conversationClosedReason: latestSessionVariables.conversationClosedReason || 'agent_closing_phrase'
      },
      suppressOutbound: true
    }
  }

  if(useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === recipient.messageBody.toLowerCase().trim())){
    //Did we receive a word that matches one of our useCases?
    await DynamoDBService.deleteItemsByPartitionKey(process.env.CONTEXT_DYNAMODB_TABLE, 'phoneNumber', recipient.destinationAddress)
    let useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === recipient.messageBody.toLowerCase().trim())
    console.trace('ACTUAL USECASE : ',useCase)
    let sessionId = randomUUID()

    if (useCase.useCase.toLowerCase().trim() === 'agent') {
      const sessionVariables = {
        useCaseId: useCase.useCase,
        channel: recipient.channel,
        sessionId: sessionId,
        ...getProspectSessionVariables(recipient)
      }
      const conversation = []

      console.info('Default agent use case selected; generating first response with Bedrock Agent.')
      const guidedSessionVariables = await enrichSessionWithStrandsConversationGuidance(
        useCase,
        recipient,
        conversation,
        sessionVariables
      )
      let response = await LambdaService.invoke(useCase.responseGeneratorLambdaName, {useCase, recipient, conversation, sessionVariables: guidedSessionVariables})
      responseMessage = response.response
      const updatedSessionVariables = await maybeInvokePurchaseIntentAlertFallback(
        recipient,
        sessionVariables,
        mergeResponseSessionVariables(guidedSessionVariables, response),
        conversation
      )

      const sendResponseResult = await sendResponse(useCase, recipient, message, responseMessage, null, sessionId, updatedSessionVariables)

      return {
        responseMessage: responseMessage,
        outboundMessage: sendResponseResult.outboundMessage,
        outboundMessageId: sendResponseResult.response.messageId,
        sessionId: sendResponseResult.sessionId,
        sessionVariables: sendResponseResult.sessionVariables
      }
    }

    //Send Initial Message
    responseMessage = useCase.initialMessage
    const sendResponseResult = await sendResponse(useCase, recipient, message, responseMessage, useCase.initialImageId, sessionId, {
      useCaseId: useCase.useCase,
      channel: recipient.channel,
      sessionId: sessionId,
      ...getProspectSessionVariables(recipient)
    });

    return {
      responseMessage: responseMessage,
      outboundMessage: sendResponseResult.outboundMessage,
      outboundMessageId: sendResponseResult.response.messageId,
      sessionId: sendResponseResult.sessionId,
      sessionVariables: sendResponseResult.sessionVariables
    }

  } else {

    //Get Conversation
    let conversation = Array.isArray(existingConversation) ? existingConversation : []

    let sessionVariables = {}

    // Use passed-in useCaseId if provided, otherwise fall back to conversation history, then default to the Bedrock Agent use case.
    sessionVariables.useCaseId = recipient.useCaseId || conversation[conversation.length - 1]?.sessionVariables?.useCaseId || 'agent'
    // Reuse the previous session for Bedrock Agent continuity; create one only for a new conversation.
    sessionVariables.sessionId = conversation[conversation.length - 1]?.sessionVariables?.sessionId || randomUUID()

    if (conversation[conversation.length - 1]?.sessionVariables?.llmSessionId) sessionVariables.llmSessionId = conversation[conversation.length - 1].sessionVariables.llmSessionId
    if (conversation[conversation.length - 1]?.sessionVariables?.channel) sessionVariables.channel = conversation[conversation.length - 1].sessionVariables.channel
    if (conversation[conversation.length - 1]?.sessionVariables?.handledObjections) sessionVariables.handledObjections = conversation[conversation.length - 1].sessionVariables.handledObjections
    if (conversation[conversation.length - 1]?.sessionVariables?.priceObjectionResponseSent) sessionVariables.priceObjectionResponseSent = conversation[conversation.length - 1].sessionVariables.priceObjectionResponseSent
    if (conversation[conversation.length - 1]?.sessionVariables?.productPresentationPackChoiceResponseSent) sessionVariables.productPresentationPackChoiceResponseSent = conversation[conversation.length - 1].sessionVariables.productPresentationPackChoiceResponseSent
    if (conversation[conversation.length - 1]?.sessionVariables?.orderConfirmed) sessionVariables.orderConfirmed = conversation[conversation.length - 1].sessionVariables.orderConfirmed
    if (conversation[conversation.length - 1]?.sessionVariables?.orderConfirmedAt) sessionVariables.orderConfirmedAt = conversation[conversation.length - 1].sessionVariables.orderConfirmedAt
    if (conversation[conversation.length - 1]?.sessionVariables?.conversationClosed) sessionVariables.conversationClosed = conversation[conversation.length - 1].sessionVariables.conversationClosed
    if (conversation[conversation.length - 1]?.sessionVariables?.conversationClosedAt) sessionVariables.conversationClosedAt = conversation[conversation.length - 1].sessionVariables.conversationClosedAt
    if (conversation[conversation.length - 1]?.sessionVariables?.conversationClosedReason) sessionVariables.conversationClosedReason = conversation[conversation.length - 1].sessionVariables.conversationClosedReason
    if (conversation[conversation.length - 1]?.sessionVariables?.purchaseIntentFallbackAlertSignatures) sessionVariables.purchaseIntentFallbackAlertSignatures = conversation[conversation.length - 1].sessionVariables.purchaseIntentFallbackAlertSignatures
    if (conversation[conversation.length - 1]?.sessionVariables?.purchaseIntentFallbackAlertSentAt) sessionVariables.purchaseIntentFallbackAlertSentAt = conversation[conversation.length - 1].sessionVariables.purchaseIntentFallbackAlertSentAt
    if (conversation[conversation.length - 1]?.sessionVariables?.knownBoxQuantity) sessionVariables.knownBoxQuantity = conversation[conversation.length - 1].sessionVariables.knownBoxQuantity
    if (conversation[conversation.length - 1]?.sessionVariables?.knownDeliveryLocation) sessionVariables.knownDeliveryLocation = conversation[conversation.length - 1].sessionVariables.knownDeliveryLocation
    if (conversation[conversation.length - 1]?.sessionVariables?.knownPaymentMode) sessionVariables.knownPaymentMode = conversation[conversation.length - 1].sessionVariables.knownPaymentMode
    if (conversation[conversation.length - 1]?.sessionVariables?.orderValidationAsked) sessionVariables.orderValidationAsked = conversation[conversation.length - 1].sessionVariables.orderValidationAsked
    if (conversation[conversation.length - 1]?.sessionVariables?.whatsappGroupLinkSent) sessionVariables.whatsappGroupLinkSent = conversation[conversation.length - 1].sessionVariables.whatsappGroupLinkSent
    if (conversation[conversation.length - 1]?.sessionVariables?.sentProductMedia) sessionVariables.sentProductMedia = conversation[conversation.length - 1].sessionVariables.sentProductMedia
    if (conversation[conversation.length - 1]?.sessionVariables?.proofOrMediaOfferPending) sessionVariables.proofOrMediaOfferPending = conversation[conversation.length - 1].sessionVariables.proofOrMediaOfferPending
    if (conversation[conversation.length - 1]?.sessionVariables?.strandsIntentClassification) sessionVariables.strandsIntentClassification = conversation[conversation.length - 1].sessionVariables.strandsIntentClassification
    if (conversation[conversation.length - 1]?.sessionVariables?.strandsIntentClassificationSource) sessionVariables.strandsIntentClassificationSource = conversation[conversation.length - 1].sessionVariables.strandsIntentClassificationSource
    if (conversation[conversation.length - 1]?.sessionVariables?.strandsIntentClassificationAt) sessionVariables.strandsIntentClassificationAt = conversation[conversation.length - 1].sessionVariables.strandsIntentClassificationAt
    if (conversation[conversation.length - 1]?.sessionVariables?.strandsConversationState) sessionVariables.strandsConversationState = conversation[conversation.length - 1].sessionVariables.strandsConversationState
    if (conversation[conversation.length - 1]?.sessionVariables?.strandsResponsePolicy) sessionVariables.strandsResponsePolicy = conversation[conversation.length - 1].sessionVariables.strandsResponsePolicy
    if (!sessionVariables.channel) sessionVariables.channel = recipient.channel
    Object.assign(
      sessionVariables,
      getProspectSessionVariables(conversation[conversation.length - 1]?.sessionVariables || {}),
      getProspectSessionVariables(recipient)
    )

    if (isOrderConfirmed(sessionVariables)) {
      console.info('Order already confirmed; suppressing automatic outbound response.', {
        destinationAddress: recipient.destinationAddress,
        sessionId: sessionVariables.sessionId
      })
      return {
        responseMessage: null,
        outboundMessage: null,
        outboundMessageId: null,
        sessionId: sessionVariables.sessionId,
        sessionVariables: sessionVariables,
        suppressOutbound: true
      }
    }

    if (isConversationClosedByAgent(sessionVariables) || hasPriorAgentClosingMessage(conversation)) {
      console.info('Conversation already closed by agent; suppressing automatic outbound response.', {
        destinationAddress: recipient.destinationAddress,
        sessionId: sessionVariables.sessionId
      })
      return {
        responseMessage: null,
        outboundMessage: null,
        outboundMessageId: null,
        sessionId: sessionVariables.sessionId,
        sessionVariables: {
          ...sessionVariables,
          conversationClosed: 'true',
          conversationClosedReason: sessionVariables.conversationClosedReason || 'agent_closing_phrase'
        },
        suppressOutbound: true
      }
    }

    let useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === sessionVariables.useCaseId)
    console.trace('Determined Use Case: ', JSON.stringify(useCase, null, 2))

    //Call the response generator lambda
    const guidedSessionVariables = await enrichSessionWithStrandsConversationGuidance(
      useCase,
      recipient,
      conversation,
      sessionVariables
    )
    let response = await LambdaService.invoke(useCase.responseGeneratorLambdaName, {useCase, recipient, conversation, sessionVariables: guidedSessionVariables})
    responseMessage = response.response
    const updatedSessionVariables = await maybeInvokePurchaseIntentAlertFallback(
      recipient,
      sessionVariables,
      mergeResponseSessionVariables(guidedSessionVariables, response),
      conversation
    )

    const sendResponseResult = await sendResponse(useCase, recipient, message, responseMessage, null, sessionVariables.sessionId, updatedSessionVariables)

    return {
      responseMessage: responseMessage,
      outboundMessage: sendResponseResult.outboundMessage,
      outboundMessageId: sendResponseResult.response.messageId,
      sessionId: sendResponseResult.sessionId,
      sessionVariables: sendResponseResult.sessionVariables
    }
  }
}

const processTemplate = async (useCase, recipient, message) => {

  //find the channel in the usecase that matches the recipient channel
  let channel = useCase.channels.find(channel => channel.channel === recipient.channel)

  if(channel.channel === 'whatsapp'){
    //Call the channel processor lambda
    let response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, message})

    console.trace('response: ', response)

    // Return data needed for storage operations in main handler
    let sessionId = randomUUID()
    return {
      responseMessage: message,
      outboundMessageId: response.messageId,
      sessionId: sessionId,
      sessionVariables: {
        useCaseId: useCase.useCase,
        channel: recipient.channel,
        sessionId: sessionId,
        ...getProspectSessionVariables(recipient)
      }
    }
  } else {
    throw new Error('Unsupported channel: ' + channel.channel)
  }

}

exports.handler = async (event, _context, callback) => {
  try {
    console.info("App Version:", process.env.APPLICATION_VERSION)
    console.trace(`Event: `, JSON.stringify(event,null,2));

    let useCases = cache.get('useCases');
    if (!useCases) {
      useCases = await DynamoDBService.scan(process.env.USECASE_DYNAMODB_TABLE);
      cache.set('useCases', useCases, 300); // Cache for 5 minutes
    }

    let inboundMessage = null

    if (event.inboundMessage) { //Direct Call
      inboundMessage = event.inboundMessage
    } else if (event.body) { //API Gateway Call
      let body = JSON.parse(event.body)
      console.trace('body: ', body)
      if (body.inboundMessage) {
        inboundMessage = body.inboundMessage
      } else {
        throw new Error('No inboundMessage found in event.body')
      }
    } else {
      throw new Error('No inboundMessage found in event')
    }

    console.trace('inboundMessage: ', inboundMessage)

    let channel = inboundMessage.channel
    if(!channel) {
      //Call the Channel Finder Lambda to determine the channel
      let channelResponse = await LambdaService.invoke(process.env.CHANNEL_FINDER_LAMBDA_NAME, {recipient: inboundMessage})
      channel = channelResponse.channel
    }

    if(!inboundMessage.inboundMessageId) inboundMessage.inboundMessageId = randomUUID();

    const complianceReview = MessageComplianceService.reviewProspectMessage(inboundMessage.messageBody)
    if (!complianceReview.allowed) {
      throw new Error(`Inbound message rejected by compliance review: ${complianceReview.reasons.join(', ')}`)
    }
    if (complianceReview.changed) {
      console.info('Inbound message normalized by compliance review:', complianceReview.reasons)
      inboundMessage.complianceReview = {
        normalized: true,
        reasons: complianceReview.reasons
      }
      inboundMessage.messageBody = complianceReview.message
    }

    let message = inboundMessage.messageBody
    let useCase = null
    let responseMessage = null
    let actionResult = null
    switch(inboundMessage.action){
      case 'forward':
        //Forward the message as is to the inboundMessage sender
        useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === inboundMessage.useCaseId)
        actionResult = await forwardMessage(inboundMessage, message, useCase, inboundMessage.imageId)
        responseMessage = actionResult.responseMessage

        // Write outbound message to storage
        await writeMessageToStorage(inboundMessage, 'outbound', channel, message, actionResult.outboundMessageId, actionResult.sessionId, actionResult.sessionVariables);
        break;
      case 'process':
        actionResult = await processMessage(useCases, inboundMessage, message)
        responseMessage = actionResult.responseMessage

        // Write messages to storage
        await writeMessageToStorage(inboundMessage, 'inbound', channel, message, inboundMessage.inboundMessageId, actionResult.sessionId, actionResult.sessionVariables);
        if (!actionResult.suppressOutbound) {
          await writeMessageToStorage(inboundMessage, 'outbound', channel, actionResult.outboundMessage, actionResult.outboundMessageId, actionResult.sessionId, actionResult.sessionVariables);
        }
        break;
      case 'template':
        useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === inboundMessage.useCaseId)
        actionResult = await processTemplate(useCase, inboundMessage, message)
        responseMessage = actionResult.responseMessage

        // Write outbound message to storage
        await writeMessageToStorage(inboundMessage, 'outbound', channel, message, actionResult.outboundMessageId, actionResult.sessionId, actionResult.sessionVariables);
        break;
      default:
        break;
    }
    callback(null,{'responseMessage': responseMessage})
  }
  catch (error) {
    console.error(error);
    callback(error)
  }
}
