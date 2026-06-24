// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const BLOCK_RULES = [
  {
    reason: 'violent_threat',
    pattern: /\b(?:je\s+vais\s+(?:te|vous|le|la|les)\s+(?:tuer|frapper|exploser|massacrer)|(?:tuer|frapper|exploser|massacrer)\s+(?:quelqu'un|une\s+personne|des\s+gens))\b/i
  },
  {
    reason: 'illegal_request',
    pattern: /\b(?:acheter|vendre|fournir|livrer)\s+(?:de\s+)?(?:la\s+)?(?:cocaine|cocaïne|heroine|héroïne|meth|méthamphétamine|arme|armes)\b/i
  },
  {
    reason: 'credential_request',
    pattern: /\b(?:mot\s+de\s+passe|code\s+otp|code\s+2fa|num[eé]ro\s+de\s+carte|cryptogramme|cvv)\b/i
  }
]

const NORMALIZATION_RULES = [
  {
    reason: 'profanity',
    pattern: /\b(?:putain|merde|bordel)\b/gi,
    replacement: 'situation frustrante'
  },
  {
    reason: 'insult',
    pattern: /\b(?:connard|connasse|abruti|idiot|imb[eé]cile)\b/gi,
    replacement: 'interlocuteur peu professionnel'
  },
  {
    reason: 'accusatory_language',
    pattern: /\b(?:arnaque|escroquerie)\b/gi,
    replacement: 'pratique préoccupante'
  },
  {
    reason: 'accusatory_language',
    pattern: /\b(?:escroc|voleur|menteur)\b/gi,
    replacement: 'interlocuteur peu fiable'
  },
  {
    reason: 'aggressive_language',
    pattern: /\b(?:d[eé]teste|ha[iï]s)\b/gi,
    replacement: "n'apprécie pas"
  },
  {
    reason: 'aggressive_language',
    pattern: /\b(?:nul|pourri|lamentable)\b/gi,
    replacement: 'problématique'
  }
]

function normalizeWhitespace (message) {
  return message.replace(/\s+/g, ' ').trim()
}

function applyNormalizationRules (message) {
  let normalizedMessage = message
  const reasons = []

  for (const rule of NORMALIZATION_RULES) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(normalizedMessage)) {
      reasons.push(rule.reason)
      rule.pattern.lastIndex = 0
      normalizedMessage = normalizedMessage.replace(rule.pattern, rule.replacement)
    }
  }

  return {
    message: normalizeWhitespace(normalizedMessage),
    reasons: [...new Set(reasons)]
  }
}

export function reviewProspectMessage (messageBody) {
  const originalMessage = typeof messageBody === 'string' ? normalizeWhitespace(messageBody) : ''

  if (!originalMessage) {
    return {
      allowed: false,
      changed: false,
      message: '',
      reasons: ['empty_message']
    }
  }

  const blockingReasons = BLOCK_RULES
    .filter(rule => rule.pattern.test(originalMessage))
    .map(rule => rule.reason)

  if (blockingReasons.length > 0) {
    return {
      allowed: false,
      changed: false,
      message: originalMessage,
      reasons: [...new Set(blockingReasons)]
    }
  }

  const normalizationResult = applyNormalizationRules(originalMessage)

  return {
    allowed: true,
    changed: normalizationResult.message !== originalMessage,
    message: normalizationResult.message,
    reasons: normalizationResult.reasons
  }
}
