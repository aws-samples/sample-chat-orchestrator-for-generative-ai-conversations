// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Bridges the deterministic agent text and WhatsApp interactive messages.
// Single source of truth so OUTBOUND rendering (text -> reply buttons / CTA URL)
// and INBOUND parsing (button id -> canonical phrase) stay in sync.
//
// Inbound strategy: a tapped button is translated into the exact natural-language
// phrase the intent classifier already handles, so no classifier change is needed.

const norm = (value = '') => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/['’]/g, ' ')
  .replace(/\s+/g, ' ')

// Closed-choice questions the agent asks -> reply buttons.
// WhatsApp limits: max 3 buttons, title <= 20 chars, id <= 256 chars.
const BUTTON_CHOICES = [
  {
    id: 'quantity_pack_choice',
    // "Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?" (+ open variant)
    match: (text) => /vous preferez commencer avec 1 boite ou faire la cure avec 2 boites/.test(norm(text)) ||
      /vous preferez commencer avec combien de boites/.test(norm(text)),
    buttons: [
      { id: 'QTY_1', title: 'PACK STARTER (1)' },
      { id: 'QTY_2', title: 'PACK BRONZE (2)' }
    ]
  },
  {
    id: 'payment_mode_choice',
    // "... payer à la livraison ou par Mobile Money."
    match: (text) => /payer a la livraison ou par mobile money/.test(norm(text)),
    buttons: [
      { id: 'PAY_COD', title: 'A la livraison' },
      { id: 'PAY_MOMO', title: 'Mobile Money' }
    ]
  },
  {
    id: 'order_recap_confirmation',
    // "Récapitulatif de votre commande: ... Confirmez-vous ce récapitulatif pour finaliser votre commande?"
    match: (text) => /ce recapitulatif pour finaliser/.test(norm(text)),
    buttons: [
      { id: 'RECAP_CONFIRM', title: 'Confirmer' },
      { id: 'RECAP_EDIT', title: 'Modifier' }
    ]
  },
  {
    id: 'order_confirmation_choice',
    // "... veuillez confirmer votre commande" / "... vous confirmez ?"
    match: (text) => /(veuillez confirmer votre commande|pour finaliser,? veuillez confirmer|vous confirmez)\b/.test(norm(text)),
    buttons: [
      { id: 'ORDER_CONFIRM', title: 'Confirmer' },
      { id: 'ORDER_EDIT', title: 'Modifier' }
    ]
  },
  {
    id: 'media_choice',
    // "Vous préférez recevoir la photo, la vidéo ou l'audio ?"
    match: (text) => /vous preferez recevoir la photo, la video ou l audio/.test(norm(text)),
    buttons: [
      { id: 'MEDIA_PHOTO', title: 'Photo' },
      { id: 'MEDIA_VIDEO', title: 'Video' },
      { id: 'MEDIA_AUDIO', title: 'Audio' }
    ]
  }
]

// CTA URL buttons: when the agent text carries a known link, surface it as a tappable button.
const URL_REGEX = /(https?:\/\/[^\s]+)/i
const CTA_LINKS = [
  { test: (url) => /mymaketou\.store/i.test(url), displayText: 'Payer maintenant' },
  { test: (url) => /chat\.whatsapp\.com/i.test(url), displayText: 'Rejoindre le groupe' }
]

const extractCtaUrl = (text = '') => {
  const match = String(text || '').match(URL_REGEX)
  if (!match) return null
  const url = match[1].replace(/[).,]+$/, '')
  const cta = CTA_LINKS.find((entry) => entry.test(url))
  if (!cta) return null
  // Drop the raw URL (and a trailing label colon) from the body to avoid duplication with the button.
  const bodyText = String(text)
    .replace(match[1], '')
    .replace(/\s*:\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { kind: 'cta_url', bodyText: bodyText || cta.displayText, displayText: cta.displayText, url }
}

// Reminder appended to the WhatsApp body whenever reply buttons are shown,
// so the prospect always knows the choice can be made by tapping a button.
// Render-time only: the stored conversation text stays unchanged.
const BUTTON_CHOICE_REMINDER = '👉 Faites votre choix en cliquant simplement sur l’un des boutons ci-dessous.'

const withButtonReminder = (text = '') => {
  const body = String(text || '').trimEnd()
  if (norm(body).includes(norm(BUTTON_CHOICE_REMINDER))) return body
  return `${body}\n\n${BUTTON_CHOICE_REMINDER}`
}

// Decide how an outbound agent message should be rendered on WhatsApp.
// Returns null when it should stay a plain text message.
export const buildInteractiveMessage = (text = '') => {
  if (!text || typeof text !== 'string') return null
  const cta = extractCtaUrl(text)
  if (cta) return cta
  const choice = BUTTON_CHOICES.find((entry) => entry.match(text))
  if (choice) return { kind: 'buttons', bodyText: withButtonReminder(text), buttons: choice.buttons }
  return null
}

// Inbound: translate a tapped button id into the canonical phrase the classifier already handles.
const BUTTON_REPLY_TEXT = {
  QTY_1: 'Je prends 1 boîte (PACK STARTER).',
  QTY_2: 'Je prends 2 boîtes (PACK BRONZE).',
  PAY_COD: 'Je paie à la livraison.',
  PAY_MOMO: 'Je veux payer par Mobile Money.',
  ORDER_CONFIRM: 'Je confirme ma commande.',
  ORDER_EDIT: 'Je voudrais modifier ma commande.',
  RECAP_CONFIRM: 'Je valide le récapitulatif de ma commande.',
  RECAP_EDIT: 'Je voudrais modifier ma commande.',
  MEDIA_PHOTO: 'Envoyez-moi la photo.',
  MEDIA_VIDEO: 'Envoyez-moi la vidéo.',
  MEDIA_AUDIO: "Envoyez-moi l'audio."
}

export const mapButtonReplyToText = (id = '', fallbackTitle = '') => {
  if (id && BUTTON_REPLY_TEXT[id]) return BUTTON_REPLY_TEXT[id]
  return fallbackTitle ? String(fallbackTitle) : null
}
