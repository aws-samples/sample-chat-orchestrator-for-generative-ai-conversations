const BedrockService = require('../services/BedrockService.mjs')
const Utilities = require('../services/UtilitiesService.mjs')
const WhatsAppService = require('../services/WhatsAppService.mjs')

const SEND_PRODUCT_MEDIA_ACTION_GROUP = 'SendProductMediaActions'
const SEND_PRODUCT_MEDIA_FUNCTION = 'sendProductMedia'
const MAX_RETURN_CONTROL_ITERATIONS = 3
const MAX_PRODUCT_MEDIA_SENDS_PER_TURN = (() => {
  const parsed = Number.parseInt(process.env.MAX_PRODUCT_MEDIA_SENDS_PER_TURN || '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
})()
const MEDICAL_MENTION_BRONZE_RESPONSE = "Dans votre cas, je vous recommande simplement de commencer avec le PACK BRONZE de 2 boîtes de Miira-Cell+ à 86 000 FCFA."
const MEMBERSHIP_RESPONSE = "Quand vous achetez 1 ou 2 boîtes de Miira-Cell+, vous devenez automatiquement partenaire REVOOBIT. Ce statut vous donne droit à un avantage concret : dès votre prochain achat, la boîte de Miira-Cell+ vous revient à 35 000 FCFA au lieu de 43 000 FCFA, soit une économie de 8 000 FCFA."
const INGREDIENTS_KB_NOT_CONFIGURED_RESPONSE = "Je dois vérifier la liste exacte des ingrédients dans les documents PDF de présentation avant de vous répondre, mais la base de connaissance n'est pas configurée pour cette question."
const INGREDIENTS_KB_NOT_FOUND_RESPONSE = "Je n'ai pas trouvé la liste exacte des 13 ingrédients dans le PDF REVOOBIT de la base de connaissance. Je préfère ne pas inventer cette information."
const INGREDIENTS_KB_UNAVAILABLE_RESPONSE = "Je dois vérifier cette information dans le PDF REVOOBIT, mais la base de connaissance est indisponible pour le moment. Je préfère ne pas inventer la liste des ingrédients."
const INGREDIENTS_SOURCE_FILENAME_TOKEN = 'REVOOBIT'
const DEFAULT_INGREDIENT_NAME_TRANSLATIONS = {
  'acerola cherry': 'cerise acérola',
  'apple extract': 'extrait de pomme',
  'apple stem cell extract': 'extrait de cellules souches de pomme',
  'apple stem cells': 'cellules souches de pomme',
  'apple': 'pomme',
  'barley grass': "herbe d'orge",
  'bilberry extract': 'extrait de myrtille',
  'black seed': 'graine de nigelle',
  'blueberry extract': 'extrait de myrtille',
  'coenzyme q10': 'coenzyme Q10',
  'collagen': 'collagène',
  'cordyceps': 'cordyceps',
  'curcumin': 'curcumine',
  'extract': 'extrait',
  'fructooligosaccharides': 'fructo-oligosaccharides',
  'ginger': 'gingembre',
  'ginkgo biloba': 'ginkgo biloba',
  'glutathione': 'glutathion',
  'grape seed extract': 'extrait de pépins de raisin',
  'green tea extract': 'extrait de thé vert',
  'hyaluronic acid': 'acide hyaluronique',
  'inulin': 'inuline',
  'lactobacillus': 'lactobacille',
  'lycopene': 'lycopène',
  'malus domestica': 'pommier domestique',
  'milk thistle': 'chardon-Marie',
  'moringa': 'moringa',
  'pomegranate': 'grenade',
  'probiotic': 'probiotique',
  'probiotics': 'probiotiques',
  'resveratrol': 'resvératrol',
  'royal jelly': 'gelée royale',
  'sea buckthorn': 'argousier',
  'selenium': 'sélénium',
  'spirulina': 'spiruline',
  'stem cell': 'cellule souche',
  'stem cells': 'cellules souches',
  'vitamin c': 'vitamine C',
  'vitamin e': 'vitamine E',
  'wheatgrass': 'herbe de blé',
  'zinc': 'zinc'
}
const PRODUCT_FORM_FACTOR_RULE = "Ne dis jamais que la boîte de Miira-Cell+ contient des gélules, capsules ou comprimés. Dis toujours qu'elle contient des sachets de poudre."
const PRODUCT_SALES_UNIT_RULE = "Règle unité de vente Miira-Cell+: si le prospect parle d'acheter, commander, prendre, recevoir ou se faire livrer un ou plusieurs sachets de Miira-Cell+, corrige-le clairement et parle de boîte de Miira-Cell+. Dis que Miira-Cell+ se vend par boîte, pas par sachet, et que chaque boîte contient 24 sachets de poudre. Ne transforme pas la posologie: on dit toujours 1 sachet par jour pour l'utilisation."
const PRODUCT_POSOLOGY_RESPONSE = "Une boîte contient 24 sachets. Il faut prendre 1 sachet de Miira-Cell+ par jour, chaque matin à jeun, à mettre sous la langue; une boîte couvre donc 24 jours."
const PRODUCT_POSOLOGY_BUDGET_SAFETY_RESPONSE = "Non, je ne peux pas dire qu'il faut forcément 10 ou 20 boîtes pour un traitement. Miira-Cell+ est un complément alimentaire, donc il ne remplace pas un avis médical. Pour l'utilisation: 1 sachet par jour, chaque matin à jeun, sous la langue; une boîte contient 24 sachets et coûte 43 000 FCFA."
const TREATMENT_BOX_COUNT_RESPONSE = "Tout dépend de l'organisme. Beaucoup de nos clients commencent avec 2 boîtes pour une cure et évaluent en fonction de leur ressenti."
const BOX_CONTENT_RESPONSE = "Une boîte de Miira-Cell+ contient 24 sachets de poudre."
const PRODUCT_POSOLOGY_RULE = "Règle posologie Miira-Cell+ absolue: pour toute demande de posologie, dosage, quantité, fréquence, durée, mode d'emploi, prise matin/soir, sachets par jour ou question du type \"1 ou 2 sachets ?\", réponds toujours qu'il faut prendre 1 sachet de Miira-Cell+ par jour, chaque matin à jeun, sous la langue. Ne dis jamais de prendre 2 sachets par jour."
const PRODUCT_PRESENTATION_PACK_CHOICE_RESPONSE = "Miira-Cell+ est un complément alimentaire naturel qui soutient la régénération cellulaire, la vitalité et le système immunitaire. Nous proposons deux packs: PACK STARTER à 43 000 FCFA la boîte, et PACK BRONZE à 86 000 FCFA pour 2 boîtes, recommandé pour une cure. Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes?"
const PRODUCT_PRESENTATION_PACK_CHOICE_RESPONSE_PATTERN = /Miira-Cell\+ est un complément alimentaire naturel qui soutient la régénération cellulaire, la vitalité et le système immunitaire\. Nous proposons deux packs: PACK STARTER à 43 000 FCFA la boîte, et PACK BRONZE à 86 000 FCFA pour 2 boîtes, recommandé pour une cure\. Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes\s*\?/i
const PRODUCT_INFO_AND_BUSINESS_LOCATION_RESPONSE = `${PRODUCT_PRESENTATION_PACK_CHOICE_RESPONSE}\n\nNous sommes à Abidjan, Cocody.`
const BUSINESS_LOCATION_RESPONSE = 'Nous sommes à Abidjan, Cocody.'
const PRICE_PACKS_RESPONSE = "Le prix de Miira-Cell+ est de 43 000 FCFA pour 1 boîte et 86 000 FCFA pour 2 boîtes. Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?"
const ONE_BOX_BRONZE_CORRECTION_RESPONSE = "Pour 1 boîte, on parle plutôt du PACK STARTER à 43 000 FCFA. Le PACK BRONZE correspond à 2 boîtes à 86 000 FCFA pour une cure. Si vous voulez tester avec 1 boîte, je note donc PACK STARTER à 43 000 FCFA; vous confirmez ?"
const ONE_BOX_PRICE_AND_CONTENT_RESPONSE = "Une boîte de Miira-Cell+ coûte 43 000 FCFA et contient 24 sachets de poudre. Le PACK BRONZE de 2 boîtes est à 86 000 FCFA pour une cure. Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?"
const ONE_BOX_PRICE_AND_CONTENT_DIRECT_RESPONSE = "Une boîte de Miira-Cell+ coûte 43 000 FCFA et contient 24 sachets de poudre."
const ONE_BOX_PRICE_AND_CONTENT_RULE = "Règle prix d'une boîte: si le prospect demande \"Une boîte fait combien ?\", \"la boîte coûte combien ?\", \"combien coûte une boîte ?\" ou une variante proche, réponds clairement qu'une boîte de Miira-Cell+ coûte 43 000 FCFA et contient 24 sachets de poudre, indique aussi que le PACK BRONZE de 2 boîtes est à 86 000 FCFA pour une cure, puis reprends le flow de vente en demandant s'il préfère commencer avec 1 boîte ou faire la cure avec 2 boîtes. Ne demande pas le lieu de livraison à cette étape."
const DIRECT_ORDER_WITHOUT_QUANTITY_RESPONSE = "Miira-Cell+ est disponible en PACK STARTER à 43 000 FCFA la boîte, ou en PACK BRONZE à 86 000 FCFA les 2 boîtes pour une cure. Le PACK BRONZE est naturellement recommandé pour bien suivre la cure. Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?"
const PRODUCT_AVAILABILITY_RESPONSE = "Passer la commande ici et nous allons vous livrer. Vous préférez commencer avec combien de boîtes ?"
const COTE_DIVOIRE_AVAILABILITY_RESPONSE = "Oui, Miira-Cell+ est disponible en Côte d'Ivoire. La commande peut se faire ici et nous organisons la livraison."
const PRODUCT_AVAILABILITY_RULE = "Règle stricte disponibilité/point d'achat: si le prospect demande où avoir, où trouver, où acheter, où se procurer ou où commander le produit, réponds exactement: \"La commande peut se faire ici et nous organisons la livraison.\" Ne donne pas d'adresse, ne demande pas le lieu de livraison et ne redirige pas vers le site."
const GABON_REPRESENTATION_RESPONSE = "Oui, nous avons une représentation au Gabon. Vous préférez commencer avec combien de boîtes ?"
const GABON_DELIVERY_DIRECT_RESPONSE = "Oui, nous avons une représentation au Gabon. Pour Libreville, vous pouvez commander ici et nous organisons la livraison."
const PORT_GENTIL_PAYMENT_DELIVERY_RESPONSE = "Pour Port-Gentil au Gabon, la commande peut se faire ici et l'equipe organise la livraison. Pour le paiement, vous pouvez payer selon les options disponibles au moment de finaliser la commande."
const GABON_DELIVERY_FOLLOW_UP_RESPONSE = "Pour répondre précisément: oui, c'est possible au Gabon, notamment pour Libreville. La commande se fait ici et l'équipe organise la livraison."
const GABON_DELIVERY_REPEAT_RESPONSE = "Je confirme pour Libreville: le produit peut être obtenu via cette conversation, puis la livraison est coordonnée au Gabon."
const AI_SUSPICION_GABON_RESPONSE = "Je comprends votre remarque. Oui, nous avons une représentation au Gabon et nous pouvons vous orienter pour Libreville. Vous parlez avec l'équipe Miira-Cell+."
const GABON_NUMBER_LOCATION_RESPONSE = "Confirmez votre commande ici et nous organisons la livraison en vous mettant en relation avec notre représentante au Gabon"
const AI_SUSPICION_RESPONSE = "Je comprends votre question. Vous parlez avec l'equipe Miira-Cell+; je suis la pour repondre clairement a vos questions sur le produit."
const PROOF_SAFETY_RESPONSE = "Je comprends votre prudence. Je préfère rester transparent: je ne vais pas inventer de brevet ni affirmer une certification ici. Miira-Cell+ est un complément alimentaire; pour votre sécurité, demandez aussi l'avis medical de votre medecin."
const PROOF_SAFETY_FOLLOW_UP_RESPONSE = "Vous avez raison d'être prudent. Ne vous fiez pas seulement à mes propos: demandez l'avis medical de votre medecin et basez-vous sur les informations vérifiables disponibles avant de décider."
const MEDICAL_TESTIMONIAL_SAFETY_RESPONSE = "Pour les témoignages, je peux vous orienter vers les supports disponibles, mais ils ne remplacent pas un avis medical. Pour les effets secondaires ou votre cas de diabete sous insuline, demandez d'abord l'avis de votre medecin."
const PRODUCT_VIDEO_RESPONSE = "Oui, je peux vous orienter vers les videos disponibles sur Miira-Cell+. Gardez simplement en tête que ces supports ne remplacent pas un avis medical."
const MEDICAL_CONTEXT_ORDER_INFO_RESPONSE = "Pour commander, cela se fait ici dans la conversation. Comme vous avez mentionné une situation médicale, gardez en tête que Miira-Cell+ est un complément alimentaire et ne remplace pas l'avis medical de votre medecin."
const MEDICAL_SUPPLEMENT_REMINDER = "Comme vous avez mentionné une situation médicale, gardez en tête que Miira-Cell+ est un complément alimentaire et ne remplace pas l'avis medical de votre medecin."
const GABON_REPRESENTATION_RULE = "Règle stricte représentation Gabon: si le prospect demande si nous avons une représentation, un représentant, une agence, un bureau, une présence ou un point de vente au Gabon, réponds clairement par l'affirmative: \"Oui, nous avons une représentation au Gabon.\" Ne dis jamais que nous n'avons pas de représentation au Gabon. Réponds à sa question avant de reprendre le flow de vente."
const DELIVERY_LOCATION_LOOKUP_RULE = "Quand le prospect donne son lieu de livraison, vérifie si ce lieu est situé à Abidjan ou en dehors afin d'ajuster les frais de livraison. Si ce n'est pas évident, tu peux faire une recherche sur internet avant de calculer les frais."
const ABIDJAN_PAYMENT_OPTIONS_RULE = "Quand le lieu de livraison est à Abidjan, dis explicitement au prospect qu'il peut payer soit à la livraison, soit par Mobile Money."
const ONE_BOX_PAYMENT_LINK = 'https://miiragenesia.mymaketou.store/fr/products/miira-cell/checkout'
const TWO_BOX_PAYMENT_LINK = 'https://miiragenesia.mymaketou.store/fr/products/miira-cell-1/checkout'
const WHATSAPP_GROUP_LINK = 'https://chat.whatsapp.com/DJXDnrp2HYk4vBlWKUUs65'
const WHATSAPP_GROUP_PRESENTATION_MESSAGE = `Rejoignez aussi notre groupe WhatsApp pour retrouver tout ce qu'il faut savoir sur Miira-Cell+, les autres produits MiiraCare, le plan d'affaire REVOOBIT, les témoignages, les évènements et les informations complémentaires: ${WHATSAPP_GROUP_LINK}`
const MOBILE_MONEY_PAYMENT_LINKS_RULE = `Règle stricte paiement en ligne: si le prospect souhaite payer par Mobile Money, Wave, Orange Money, Moov Money, MTN Money, VISA ou tout autre paiement en ligne, envoie obligatoirement le lien correspondant à sa commande. Pour 1 boîte de Miira-Cell+, envoie uniquement ${ONE_BOX_PAYMENT_LINK}. Pour 2 boîtes de Miira-Cell+, envoie uniquement ${TWO_BOX_PAYMENT_LINK}. Si la quantité n'est pas claire, demande d'abord s'il veut 1 boîte ou 2 boîtes avant d'envoyer un lien.`
const SILENCE_AFTER_ORDER_CONFIRMATION_RULE = "Après avoir répondu au prospect suite à sa confirmation finale d'une commande déjà récapitulée avec lieu de livraison, ne relance plus, ne pose plus de question et n'envoie plus aucun autre message dans cette conversation."
const SILENCE_AFTER_CLOSING_RULE = "Après avoir employé une formule de départ comme \"À bientôt\", \"au revoir\", \"bye\", \"bonne journée\", \"bonne soirée\" ou toute formule similaire, considère la conversation terminée: ne relance plus, ne pose plus de question et n'envoie plus aucun autre message dans cette conversation."
const WHATSAPP_GROUP_DURING_PRESENTATION_RULE = `Lors de la présentation de Miira-Cell+, et uniquement à ce moment précis de la session de conversation, envoie au prospect le lien du groupe WhatsApp: ${WHATSAPP_GROUP_LINK}. Présente-le comme le groupe où il peut retrouver tout ce qu'il faut savoir sur Miira-Cell+, les autres produits MiiraCare, le plan d'affaire REVOOBIT, les témoignages, les évènements et les informations complémentaires. Si le lien du groupe WhatsApp a déjà été envoyé dans cette session, ne le renvoie plus. Ne l'envoie pas lors d'une confirmation de commande, d'une fin de conversation ou d'une formule de départ.`
const SALES_FLOW_DEFAULT_RULE = "Règle de flow de vente par défaut: sauf cas de priorité de réponse explicite, suis toujours le FLOW DE VENTE. Si le prospect dit \"je veux commander\" ou manifeste une intention d'achat sans quantité claire, ne saute jamais les étapes: présente brièvement les deux packs, recommande naturellement le PACK BRONZE, puis demande combien de boîtes il préfère. Si le prospect pose une question précise, réponds d'abord clairement à cette question, puis reprends immédiatement l'étape utile du flow de vente. Exception stricte: si le prospect manifeste un achat direct avec une quantité, par exemple \"2 boîtes svp\", ne lance pas le flow; reconnais la quantité et demande uniquement s'il valide cette commande. Ne demande jamais le lieu de livraison à cette étape."
const INFO_REQUEST_NOT_PURCHASE_RULE = "Règle stricte demande d'information: si le prospect dit \"Bonjour ! Puis-je en savoir plus à ce sujet ?\", \"puis-je en savoir plus\", \"je veux en savoir plus\" ou une variante proche, ne considère jamais cela comme une intention d'achat et n'appelle pas PurchaseIntentActions.notifyPurchaseIntent. Traite ce message comme une demande d'information vague: réponds normalement en suivant le FLOW DE VENTE."
const DELIVERY_AFTER_ORDER_VALIDATION_RULE = "Règle stricte livraison: ne demande jamais la ville, commune, quartier, adresse ou lieu de livraison tant que le prospect n'a pas explicitement validé sa commande. Une quantité seule, un choix de pack ou une intention d'achat n'est pas encore une validation. Après validation explicite seulement, si le lieu manque, demande uniquement: \"Dans quelle ville, commune ou quartier souhaitez-vous être livré ?\""
const PRICE_OBJECTION_RESPONSE = "La réalité, c’est que la plupart des solutions moins chères traitent uniquement les symptômes… sans jamais s’attaquer à la cause. Ici, l’approche est différente : le produit agit directement au niveau cellulaire, là où se joue réellement votre vitalité. Beaucoup de nos clients nous disent la même chose : ils ont essayé plusieurs solutions inefficaces… et ont finalement dépensé bien plus sans résultat. Aujourd’hui, ils voient cet achat non pas comme une dépense, mais comme un investissement durable dans leur santé."
const PRICE_HIGH_SHORT_RESPONSE = "Je comprends, le budget compte. Pour le moment, je ne peux pas confirmer de réduction ici. Le mieux est de choisir le pack qui vous convient le plus, ou de revenir quand ce sera plus confortable pour vous."
const BUSINESS_RESELLER_CLARIFICATION_RESPONSE = "Oui, je comprends pour le groupe de vente. Vous souhaitez rejoindre le groupe comme client pour suivre les informations, ou vous voulez des renseignements pour devenir revendeur/partenaire ?"
const BUSINESS_RESELLER_CLIENT_THEN_RESELLER_RESPONSE = "D'accord, vous pouvez d'abord suivre les informations comme client, puis demander les renseignements revendeur/partenaire quand vous serez prêt."
const BUSINESS_RESELLER_BOTH_CASES_RESPONSE = "D'accord, vous pouvez suivre les informations comme client, et pour l'option revendeur/partenaire je transmets votre intérêt à l'équipe commerciale afin qu'elle vous oriente sur les conditions."
const BUSINESS_RESELLER_FOLLOW_UP_RESPONSE = "Pour les renseignements partenaire/revendeur, je transmets votre intérêt à l'équipe commerciale afin qu'elle vous oriente sur les conditions et les prochaines étapes. Je reste disponible si vous avez une précision à demander."
const BUSINESS_RESELLER_REPEAT_FOLLOW_UP_RESPONSE = "C'est noté pour les renseignements partenaire/revendeur. L'équipe commerciale pourra vous donner les conditions; je reste disponible pour une question précise."
const BUSINESS_RESELLER_FINAL_FOLLOW_UP_RESPONSE = "Votre demande de renseignements partenaire/revendeur est bien prise en compte. Je reste disponible pour toute autre précision."
const SENT_MESSAGES_REVIEW_RESPONSE = "Ok, si vous avez d'autres questions ou préoccupations je suis là"
const ANTI_HARD_SELL_QUESTIONS_RESPONSE = "Vous avez raison. Posez toutes vos questions d'abord, y compris si vous avez une situation de sante particuliere; je vous reponds clairement avant toute commande."
const INAPPROPRIATE_CONTENT_RESPONSE = "Je ne peux pas aider avec ce type de contenu. Je peux par contre répondre à vos questions sur Miira-Cell+."
const UNCLEAR_MESSAGE_RESPONSE = "Pouvez-vous préciser ce que vous souhaitez savoir sur Miira-Cell+ ?"
const EXTERNAL_PROMOTION_RESPONSE = "Merci pour votre message. Je peux vous aider uniquement pour les questions liées à Miira-Cell+."
const NEUTRAL_FOLLOW_UP_RESPONSE = "Merci, je reste disponible si vous avez une question ou si vous souhaitez continuer plus tard."
const NEUTRAL_FOLLOW_UP_REPEAT_RESPONSE = "Bien reçu. Je reste disponible pour une précision sur Miira-Cell+."
const PROSPECT_SESSION_FIELDS = [
  'ctwa_clid'
]
const KNOWN_PROSPECT_INFO_FIELDS = [
  'knownBoxQuantity',
  'knownDeliveryLocation',
  'knownPaymentMode',
  'orderValidationAsked',
  'prospectConfirmedOrder',
  'knownContactName',
  'knownContactEmail',
  'knownContactPhone'
]

const OBJECTION_DEFINITIONS = [
  {
    id: 'price_high',
    label: 'prix élevé',
    patterns: [
      /\b(?:trop\s+cher|cher|ch[eè]re|co[uû]teux|pas\s+les?\s+moyens|pas\s+mon\s+budget)\b/i,
      /\bje\s+cherche\s+un\s+peu\s+d['’]argent\b/i,
      /\b(?:prix|tarif|montant)\b.{0,40}\b(?:[eé]lev[eé]|cher|ch[eè]re|haut|beaucoup)\b/i,
      /\bc['’]est\s+(?:trop\s+)?(?:beaucoup|[eé]lev[eé])\b/i,
      /\b(?:je\s+n['’]ai|j['’]ai\s+pas|je\s+ne\s+dispose\s+pas)\s+(?:pas\s+)?(?:encore\s+)?(?:de\s+)?(?:l['’])?argent\b/i,
      /\b(?:pas\s+encore|manque|insuffisance\s+d['’]?)argent\b/i,
      /\b(?:budget|moyens?)\s+(?:serr[eé]|limit[eé]s?|insuffisant|faible)\b/i,
      /\b(?:je\s+vais|je\s+dois|il\s+faut\s+que\s+je)\s+(?:chercher|trouver|r[eé]unir|rassembler)\s+(?:un\s+peu\s+d['’])?(?:l['’])?argent\b/i,
      /\b(?:\d+|un|une|deux|trois)\s*bo[iî]tes?b?\s*(?:a|à|pour)?\s*\d{2,5}\s*k?\b/i,
      /\b(?:apr[eè]s|fin\s+du|[aà]\s+la\s+fin\s+du)\s+(?:mois|salaire|paie)\b/i
    ]
  },
  {
    id: 'delay_or_follow_up',
    label: 'report / je vous reviens',
    patterns: [
      /\b(?:je\s+(?:vous\s+)?reviens|je\s+reviens\s+vers\s+vous|je\s+vais\s+revenir|je\s+reviendrai|je\s+reviendrais|je\s+vous\s+rappelle|je\s+vous\s+(?:re)?contacte|je\s+vous\s+fais\s+signe|je\s+vous\s+[eé]cris\s+apr[eè]s)\b/i,
      /\b(?:je\s+vais\s+r[eé]fl[eé]chir|je\s+vais\s+voir|je\s+garde\s+votre\s+contact|plus\s+tard|pas\s+maintenant|fin\s+du\s+mois|apr[eè]s\s+salaire)\b/i,
      /\b(?:quand|d[eè]s\s+que)\s+j['’]aurai\s+(?:le\s+)?(?:budget|l['’]?argent)\b/i
    ]
  },
  {
    id: 'spouse_or_relative',
    label: 'avis conjoint / proche',
    patterns: [
      /\b(?:en\s+parler|demander\s+l['’]avis|voir\s+avec)\s+(?:a\s+|à\s+)?(?:mon|ma|mes|un|une)\s+(?:conjoint|conjointe|mari|femme|epoux|[eé]poux|[eé]pouse|fr[eè]re|s[œo]ur|soeur|parent|famille|proche)\b/i,
      /\b(?:mon|ma)\s+(?:conjoint|conjointe|mari|femme|epoux|[eé]poux|[eé]pouse|famille)\s+(?:doit|va|peut)\s+(?:voir|d[eé]cider|confirmer)\b/i
    ]
  },
  {
    id: 'delivery',
    label: 'livraison',
    patterns: [
      /\b(?:livraison|livrer|livrez|livr[eé]|commune|quartier|frais\s+de\s+livraison|lieu\s+de\s+livraison|d[eé]lai\s+de\s+livraison)\b/i
    ]
  },
  {
    id: 'payment',
    label: 'paiement',
    patterns: [
      /\b(?:paiement|payer|paie|pay[eé]|cash|mobile\s+money|momo|orange\s+money|wave|moov\s+money|mtn\s+money|visa|paiement\s+[aà]\s+la\s+livraison|avance|acompte)\b/i
    ]
  },
  {
    id: 'composition',
    label: 'composition / ingrédients',
    patterns: [
      /\b(?:composition|ingr[eé]dients?|contenu|contient|dedans|dans\s+la\s+bo[iî]te|sachets?|poudre|g[eé]lules?|capsules?|comprim[eé]s?)\b/i
    ]
  },
  {
    id: 'safety_or_medical',
    label: 'sécurité / contre-indications',
    patterns: [
      /\b(?:danger|dangereux|risque|effets?\s+secondaires?|contre[-\s]?indications?|maladie|traitement\s+m[eé]dical|m[eé]dicaments?|grossesse|enceinte|allaitement|diab[eè]te|hypertension|avis\s+m[eé]dical|m[eé]decin)\b/i
    ]
  },
  {
    id: 'availability',
    label: 'disponibilité',
    patterns: [
      /\b(?:disponible|disponibilit[eé]|en\s+stock|stock|rupture|reste|encore\s+disponible|vous\s+avez\s+[cç]a)\b/i
    ]
  },
  {
    id: 'trust_or_proof',
    label: 'confiance / preuve',
    patterns: [
      /\b(?:arnaque|escroquerie|faux|fake|mensonge|pas\s+confiance|je\s+doute|preuve|preuves|t[eé]moignages?|avis\s+clients?)\b/i,
      /\b(?:comment\s+(?:savoir|croire)|est-ce\s+fiable|c['’]est\s+fiable)\b/i
    ]
  },
  {
    id: 'efficacy',
    label: 'efficacité',
    patterns: [
      /\b(?:efficace|efficacit[eé]|r[eé]sultats?|garantie|[cç]a\s+marche|[cç]a\s+fonctionne|et\s+si\s+[cç]a\s+ne\s+marche\s+pas)\b/i
    ]
  }
]

const normalizeHandledObjections = (handledObjections = []) => {
  if (Array.isArray(handledObjections)) return handledObjections.filter(Boolean)
  if (typeof handledObjections !== 'string') return []

  try {
    const parsed = JSON.parse(handledObjections)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch (_error) {
    return handledObjections.split(',').map((value) => value.trim()).filter(Boolean)
  }
}

const detectObjections = (messageBody = '') => {
  const value = normalizeResponseForComparison(messageBody)
  if (/\b(?:2|deux)\s*boites?b?\s*(?:a|pour)?\s*86\s*k\b/.test(value) ||
    /\b(?:1|un|une)\s*boites?b?\s*(?:a|pour)?\s*43\s*k\b/.test(value)) {
    return []
  }

  return OBJECTION_DEFINITIONS
    .filter((definition) => definition.patterns.some((pattern) => pattern.test(messageBody || '')))
    .map(({ id, label }) => ({ id, label }))
}

const hasExplicitOrderConfirmation = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:je\s+)?confirm(?:e|er|ons)\b/.test(value) ||
    /\b(?:c(?:'|’)?est\s+)?(?:bon|ok|okay|daccord|d accord|valide|validez)\b/.test(value) ||
    /\b(?:oui|ok|okay)\s*(?:c(?:'|’)?est\s+)?(?:bon|confirme|valide|validez)\b/.test(value)
}

const hasOrderConfirmationRequest = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:confirmez|confirmer|confirmation|vous\s+confirmez|puis-je\s+confirmer)\b/.test(value) ||
    /\b(?:voulez vous|souhaitez vous).{0,40}\b(?:proceder|passer|valider|confirmer).{0,40}\bcommande\b/.test(value) ||
    /\b(?:validez|valider|confirmez|confirmer).{0,40}\bcette\s+commande\b/.test(value)
}

const hasOrderValidationRequest = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:voulez vous|souhaitez vous).{0,40}\b(?:proceder|passer|valider|confirmer).{0,40}\bcommande\b/.test(value) ||
    /\b(?:validez|valider|confirmez|confirmer).{0,40}\bcette\s+commande\b/.test(value) ||
    /\b(?:cette\s+commande).{0,40}\b(?:validee|confirmee|validez|confirmez)\b/.test(value)
}

const wantsToReviewSentMessages = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\blaiss(?:e|ez|er)(?:\s|-)+moi\s+prendre\s+connaissance\s+des\s+messages?\s+envoyes\b(?:\s*(?:svp|s['’ ]?il\s+vous\s+plait))?/.test(value)
}

const hasDirectOrderIntentWithoutQuantity = (message = '') => {
  const value = normalizeResponseForComparison(message)
  const hasDirectOrderIntent = /\b(?:je\s+)?(?:veux|souhaite|voudrais|vais)\s+(?:commander|acheter|prendre|reserver)\b/.test(value) ||
    /\b(?:je\s+)?(?:commande|achete|reserve)\b/.test(value)
  const hasQuantity = /\b(?:1|une?|2|deux)\s*(?:boites?|boite|packs?|cures?)\b/.test(value)

  return hasDirectOrderIntent && !hasQuantity
}

const isOrderConfirmationTurn = (message = '', conversation = [], response = '') => {
  if (!hasExplicitOrderConfirmation(message)) return false
  if (normalizeResponseForComparison(response).includes('commande confirmee')) return true

  return conversation
    .filter((conversationMessage) => conversationMessage.direction === 'outbound')
    .slice(-3)
    .some((conversationMessage) => hasOrderConfirmationRequest(conversationMessage.message || ''))
}

const buildRepeatedObjectionInstruction = (currentObjections = [], handledObjections = []) => {
  const handledSet = new Set(normalizeHandledObjections(handledObjections))
  const repeatedLabels = currentObjections
    .filter((objection) => handledSet.has(objection.id))
    .map((objection) => objection.label)

  if (!repeatedLabels.length) return ''

  return `

Objection déjà traitée dans cette même session: ${repeatedLabels.join(', ')}.
Règle stricte: ne redonne pas la réponse correspondant à cette objection et ne consulte pas la base de connaissance pour la retraiter. Accuse réception brièvement, puis avance naturellement vers la prochaine information utile ou la prochaine étape commerciale.`
}

const hasPriceObjectionAlreadyBeenHandled = (handledObjections = [], priceObjectionResponseSent = 'false') => {
  return priceObjectionResponseSent === 'true' || normalizeHandledObjections(handledObjections).includes('price_high')
}

const buildPriceObjectionInstruction = (handledObjections = [], priceObjectionResponseSent = 'false') => {
  if (hasPriceObjectionAlreadyBeenHandled(handledObjections, priceObjectionResponseSent)) {
    return `Objection prix élevé déjà traitée dans cette même session: ne renvoie jamais cette réponse exacte ni une paraphrase proche: "${PRICE_OBJECTION_RESPONSE}" Accuse réception brièvement, puis avance naturellement vers la prochaine information utile ou la prochaine étape commerciale.`
  }

  return `Objection prix élevé: si le prospect a une objection sur le prix et le trouve élevé, ou s'il dit "Je cherche un peu d'argent", réponds avec cette réponse: "${PRICE_OBJECTION_RESPONSE}" Après cette réponse, ne demande pas "Qu'est-ce qui vous bloque exactement entre prix, budget, confiance ou efficacité ?" et ne pose pas de question d'identification du blocage.`
}

const buildProductPresentationPackChoiceInstruction = (productPresentationPackChoiceResponseSent = 'false') => {
  if (isTrueSessionFlag(productPresentationPackChoiceResponseSent)) {
    return `Présentation produit et choix de pack déjà envoyés dans cette même session: ne renvoie jamais cette réponse exacte ni une paraphrase proche: "${PRODUCT_PRESENTATION_PACK_CHOICE_RESPONSE}" Si tu dois relancer le choix, demande seulement brièvement si le prospect préfère 1 boîte ou 2 boîtes.`
  }

  return `Si tu présentes Miira-Cell+ avec les deux packs, tu peux utiliser cette réponse une seule fois dans toute la session: "${PRODUCT_PRESENTATION_PACK_CHOICE_RESPONSE}"`
}

const mergeHandledObjections = (handledObjections = [], currentObjections = []) => {
  return Array.from(new Set([
    ...normalizeHandledObjections(handledObjections),
    ...currentObjections.map((objection) => objection.id)
  ]))
}

const markHandledObjectionsAfterResponse = (sessionVariables = {}, currentObjections = [], response = '') => {
  if (!String(response || '').trim()) return sessionVariables

  const updatedSessionVariables = {
    ...sessionVariables,
    handledObjections: mergeHandledObjections(sessionVariables.handledObjections, currentObjections)
  }

  if (responseContainsPriceObjectionResponse(response)) {
    updatedSessionVariables.priceObjectionResponseSent = 'true'
  }

  if (hasOrderValidationRequest(response)) {
    updatedSessionVariables.orderValidationAsked = 'true'
  }

  return updatedSessionVariables
}

const buildKnownProspectInfoInstruction = (knownProspectInfo = {}) => {
  const knownFacts = [
    knownProspectInfo.knownBoxQuantity ? `- Nombre de boites deja donne par le prospect: ${knownProspectInfo.knownBoxQuantity}.` : null,
    knownProspectInfo.knownDeliveryLocation ? `- Lieu de livraison deja donne par le prospect: ${knownProspectInfo.knownDeliveryLocation}.` : null,
    knownProspectInfo.knownPaymentMode ? `- Mode de paiement deja donne par le prospect: ${knownProspectInfo.knownPaymentMode}.` : null,
    knownProspectInfo.orderValidationAsked === 'true' ? '- La question de validation de commande a deja ete posee dans cette conversation.' : null
  ].filter(Boolean)

  if (!knownFacts.length) {
    return "Regle stricte anti-repetition: avant de poser une question, verifie l'historique de conversation. Ne redemande jamais une information que le prospect a deja donnee dans cette conversation."
  }

  return `Regle stricte anti-repetition: les informations suivantes sont deja connues dans cette conversation.
${knownFacts.join('\n')}
Ne redemande jamais une information deja connue. Si une etape du flow demande une information deja connue, considere cette etape comme terminee et passe a la prochaine information manquante ou a la confirmation utile. Si la question de validation de commande a deja ete posee, ne repose pas "Voulez-vous proceder a la commande maintenant ?" ni aucune variante demandant si le prospect valide ou confirme la meme commande. Reponds au nouveau message du prospect et attends une validation explicite avant de demander le lieu de livraison.`
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

const buildConversationGuidanceInstruction = (conversationState = {}, responsePolicy = {}) => {
  if (!conversationState.currentIntent && !responsePolicy.nextBestAction) return ''

  const mustAnswer = Array.isArray(responsePolicy.mustAnswer) && responsePolicy.mustAnswer.length
    ? `\n- Points a traiter maintenant: ${responsePolicy.mustAnswer.join(', ')}.`
    : ''
  const mustNotRepeat = Array.isArray(responsePolicy.mustNotRepeat) && responsePolicy.mustNotRepeat.length
    ? `\n- Ne repete pas: ${responsePolicy.mustNotRepeat.join(', ')}.`
    : ''
  const mustAvoid = Array.isArray(responsePolicy.mustAvoid) && responsePolicy.mustAvoid.length
    ? `\n- Evite strictement: ${responsePolicy.mustAvoid.join(', ')}.`
    : ''
  const knownInfo = conversationState.knownProspectInfo || {}
  const knownFacts = [
    knownInfo.quantity ? `quantite=${knownInfo.quantity}` : null,
    knownInfo.deliveryLocation ? `lieu=${knownInfo.deliveryLocation}` : null,
    knownInfo.paymentMode ? `paiement=${knownInfo.paymentMode}` : null,
    knownInfo.medicalConcern ? 'contexte_sante=true' : null
  ].filter(Boolean)

  return `Contexte de coherence issu du classifieur Strands:
- Intention actuelle: ${conversationState.currentIntent || 'unknown'}.
- Intention precedente: ${conversationState.previousIntent || 'none'}.
- Etape conversationnelle: ${conversationState.conversationStage || 'unknown'}.
- Prochaine meilleure action: ${responsePolicy.nextBestAction || 'answer_latest_message_directly_and_avoid_repetition'}.
${knownFacts.length ? `- Informations deja connues: ${knownFacts.join(', ')}.` : '- Aucune information prospect supplementaire connue.'}${mustAnswer}${mustNotRepeat}${mustAvoid}
Regle stricte: utilise ce contexte pour rester coherent avec la session. Reponds d'abord au dernier message du prospect, ne contredis pas les informations deja connues, ne repose pas une question deja resolue, et ne relance pas commercialement si le contexte indique un sujet medical ou une cloture.`
}

const buildCompleteProspectResponsePrompt = (messageBody = '', handledObjections = [], knownProspectInfo = {}, priceObjectionResponseSent = 'false', productPresentationPackChoiceResponseSent = 'false', conversationState = {}, responsePolicy = {}) => {
  const currentObjections = detectObjections(messageBody)
  const repeatedObjectionInstruction = buildRepeatedObjectionInstruction(currentObjections, handledObjections)
  const knownProspectInfoInstruction = buildKnownProspectInfoInstruction(knownProspectInfo)
  const priceObjectionInstruction = buildPriceObjectionInstruction(handledObjections, priceObjectionResponseSent)
  const productPresentationPackChoiceInstruction = buildProductPresentationPackChoiceInstruction(productPresentationPackChoiceResponseSent)
  const conversationGuidanceInstruction = buildConversationGuidanceInstruction(conversationState, responsePolicy)

  return `Consigne interne: réponds entièrement au message exact du prospect ci-dessous, de façon directe et essentielle. ${knownProspectInfoInstruction} ${SALES_FLOW_DEFAULT_RULE} ${INFO_REQUEST_NOT_PURCHASE_RULE} ${PRODUCT_AVAILABILITY_RULE} ${GABON_REPRESENTATION_RULE} ${ONE_BOX_PRICE_AND_CONTENT_RULE} ${DELIVERY_AFTER_ORDER_VALIDATION_RULE} Si le prospect dit qu'il est intéressé et donne déjà une quantité, par exemple "Bonjour, je suis intéressée par vos produits Mira-cell. 2 boîtes svp.", traite cela comme un choix de commande: réponds sans salutation, sans présentation du produit, sans argumentaire et sans fioritures; ne demande pas le lieu de livraison, demande seulement si le prospect valide cette commande. Si le prospect pose plusieurs questions, soulève plusieurs objections ou donne plusieurs informations utiles, traite chaque point important avant de faire avancer la vente. Ne laisse aucune question explicite sans réponse. Ne pose jamais une autre question au prospect tant que tu n'as pas d'abord répondu clairement à chaque question qu'il vient de poser. Une question de relance commerciale n'est autorisée qu'après cette réponse complète. Évite les détails inutiles, les longues explications et les détours. ${PRODUCT_FORM_FACTOR_RULE} ${PRODUCT_SALES_UNIT_RULE} ${PRODUCT_POSOLOGY_RULE} ${DELIVERY_LOCATION_LOOKUP_RULE} ${ABIDJAN_PAYMENT_OPTIONS_RULE} ${MOBILE_MONEY_PAYMENT_LINKS_RULE} ${WHATSAPP_GROUP_DURING_PRESENTATION_RULE} ${SILENCE_AFTER_ORDER_CONFIRMATION_RULE} ${SILENCE_AFTER_CLOSING_RULE}

${conversationGuidanceInstruction}

${priceObjectionInstruction}

${productPresentationPackChoiceInstruction}

Objection de report à identifier: toute variante ou combinaison de "je vous reviens", par exemple "je reviens vers vous", "je vais revenir", "je reviendrai/reviendrais", "je vous rappelle", "je vous contacte/recontacte", "je vous fais signe", "je vous écris après", "on se capte après", "je vais réfléchir", "je vais voir", "je garde votre contact", "plus tard", "pas maintenant", "dès que je suis prêt", "quand j'aurai le budget/l'argent", "fin du mois", "après salaire", ou mélangé avec prix, budget, proche, confiance, efficacité ou besoin de temps. Dans ce cas, valide brièvement puis demande une seule chose: ce qui bloque exactement entre prix, budget, confiance ou efficacité.${repeatedObjectionInstruction}

Message exact du prospect:
${messageBody}`
}

const isProductMediaReturnControlResult = (returnControlResult) => {
  return returnControlResult?.functionResult?.actionGroup === SEND_PRODUCT_MEDIA_ACTION_GROUP &&
    returnControlResult?.functionResult?.function === SEND_PRODUCT_MEDIA_FUNCTION
}

const getReturnControlResponsePayload = (returnControlResult = {}) => {
  const responseBody = returnControlResult?.functionResult?.responseBody?.TEXT?.body
  if (!responseBody) return {}

  try {
    return JSON.parse(responseBody)
  } catch (error) {
    console.warn('Unable to parse return control response body', { responseBody, error: error.message })
    return {}
  }
}

const buildPostMediaResponsePrompt = (messageBody = '', returnControlResult = {}, handledObjections = [], knownProspectInfo = {}, priceObjectionResponseSent = 'false', productPresentationPackChoiceResponseSent = 'false', conversationState = {}, responsePolicy = {}) => {
  const actionResultBody = returnControlResult?.functionResult?.responseBody?.TEXT?.body || '{}'
  const currentObjections = detectObjections(messageBody)
  const repeatedObjectionInstruction = buildRepeatedObjectionInstruction(currentObjections, handledObjections)
  const knownProspectInfoInstruction = buildKnownProspectInfoInstruction(knownProspectInfo)
  const priceObjectionInstruction = buildPriceObjectionInstruction(handledObjections, priceObjectionResponseSent)
  const productPresentationPackChoiceInstruction = buildProductPresentationPackChoiceInstruction(productPresentationPackChoiceResponseSent)
  const conversationGuidanceInstruction = buildConversationGuidanceInstruction(conversationState, responsePolicy)

  return `Consigne interne stricte: un média vient d'être traité par l'action group. Tu dois maintenant répondre au prospect de façon complète.
- N'appelle plus la fonction sendProductMedia dans ce même tour: un média a déjà été traité, réponds maintenant uniquement par un message texte au prospect.
- ${knownProspectInfoInstruction}
- Si l'envoi média est confirmé comme réussi dans le résultat d'action, tu peux dire que le média a été envoyé.
- Si l'envoi média a échoué, ne dis pas qu'il a été envoyé.
- Dans tous les cas, ne t'arrête jamais au statut du média: réponds aussi à toutes les autres questions, objections, demandes de prix, livraison, posologie, composition, paiement ou commande présentes dans le message exact du prospect.
- ${PRODUCT_FORM_FACTOR_RULE}
- ${PRODUCT_SALES_UNIT_RULE}
- ${PRODUCT_POSOLOGY_RULE}
- ${PRODUCT_AVAILABILITY_RULE}
- ${GABON_REPRESENTATION_RULE}
- ${ONE_BOX_PRICE_AND_CONTENT_RULE}
- ${DELIVERY_AFTER_ORDER_VALIDATION_RULE}
- ${DELIVERY_LOCATION_LOOKUP_RULE}
- ${ABIDJAN_PAYMENT_OPTIONS_RULE}
- ${MOBILE_MONEY_PAYMENT_LINKS_RULE}
- ${WHATSAPP_GROUP_DURING_PRESENTATION_RULE}
- ${SILENCE_AFTER_ORDER_CONFIRMATION_RULE}
- ${SILENCE_AFTER_CLOSING_RULE}
- ${SALES_FLOW_DEFAULT_RULE}
- ${INFO_REQUEST_NOT_PURCHASE_RULE}
- ${conversationGuidanceInstruction}
- ${priceObjectionInstruction}
- ${productPresentationPackChoiceInstruction}
- Reste direct et va à l'essentiel: pas de longues explications, pas de détails inutiles.
- Ne laisse aucune question explicite sans réponse. Ne pose jamais une autre question au prospect tant que tu n'as pas d'abord répondu clairement à chaque question qu'il vient de poser. Fais avancer la vente avec une seule question utile seulement après cette réponse complète.${repeatedObjectionInstruction}

Résultat de l'action média:
${actionResultBody}

Message exact du prospect:
${messageBody}`
}

const mergeMediaFallbackWithAgentResponse = (mediaFallbackResponse, agentCompletion) => {
  const trimmedMediaFallbackResponse = (mediaFallbackResponse || '').trim()
  const trimmedAgentCompletion = (agentCompletion || '').trim()

  if (!trimmedAgentCompletion) return trimmedMediaFallbackResponse
  if (!trimmedMediaFallbackResponse) return trimmedAgentCompletion
  if (trimmedAgentCompletion.includes(trimmedMediaFallbackResponse)) return trimmedAgentCompletion

  const normalizedAgentCompletion = normalizeResponseForComparison(trimmedAgentCompletion)
  const deduplicatedFallbackSentences = splitResponseSentences(trimmedMediaFallbackResponse)
    .filter((sentence) => !isRepeatedMediaFallbackSentence(sentence, normalizedAgentCompletion))
  const deduplicatedFallbackResponse = deduplicatedFallbackSentences.join(' ').trim()

  if (!deduplicatedFallbackResponse) return trimmedAgentCompletion

  return `${deduplicatedFallbackResponse}\n\n${trimmedAgentCompletion}`
}

const normalizeProductFormFactorInResponse = (response = '') => {
  return (response || '')
    .replace(/\b(g[eé]lules?|capsules?|comprim[eé]s?)\b/gi, 'sachets de poudre')
}

const normalizeProductPosologyInResponse = (response = '') => {
  return (response || '')
    .replace(/\b(?:2|deux)\s+sachets?\s*(?:de\s+Miira-Cell\+\s*)?(?:par|\/)\s*jour\b/gi, '1 sachet de Miira-Cell+ par jour')
    .replace(/\b(?:2|deux)\s+sachets?\s*(?:de\s+Miira-Cell\+\s*)?chaque\s+jour\b/gi, '1 sachet de Miira-Cell+ par jour')
    .replace(/\b(?:2|deux)\s+sachets?\s*(?:de\s+Miira-Cell\+\s*)?tous\s+les\s+jours\b/gi, '1 sachet de Miira-Cell+ par jour')
    .replace(/\b(?:2|deux)\s+sachets?\s*(?:de\s+Miira-Cell\+\s*)?quotidien(?:ne)?ment\b/gi, '1 sachet de Miira-Cell+ par jour')
}

const normalizeProductSalesUnitInResponse = (response = '') => {
  return (response || '')
    .replace(/\b(commande[rz]?|commander|acheter|prendre|prenez|recevoir|envoyer|envoyez|livrer|livrez|valider|confirmer)\s+(?:un|une|1)\s+sachet\s+(?:de\s+)?Miira-Cell\+(?!\s*(?:par|\/|chaque|tous|quotidien|jour|matin|soir)\b)/gi, '$1 1 boîte de Miira-Cell+')
    .replace(/\b(commande[rz]?|commander|acheter|prendre|prenez|recevoir|envoyer|envoyez|livrer|livrez|valider|confirmer)\s+(?:deux|2)\s+sachets\s+(?:de\s+)?Miira-Cell\+(?!\s*(?:par|\/|chaque|tous|quotidien|jour|matin|soir)\b)/gi, '$1 2 boîtes de Miira-Cell+')
}

const normalizeOrderingChannelInResponse = (response = '') => {
  return (response || '')
    .replace(/\bsite\s+web\b/gi, 'WhatsApp')
}

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const parseIngredientNameTranslations = () => {
  if (!process.env.MIIRACELL_INGREDIENT_NAME_TRANSLATIONS_JSON) {
    return DEFAULT_INGREDIENT_NAME_TRANSLATIONS
  }

  try {
    return {
      ...DEFAULT_INGREDIENT_NAME_TRANSLATIONS,
      ...JSON.parse(process.env.MIIRACELL_INGREDIENT_NAME_TRANSLATIONS_JSON)
    }
  } catch (error) {
    console.warn('Invalid MIIRACELL_INGREDIENT_NAME_TRANSLATIONS_JSON; using defaults', {
      message: error?.message
    })
    return DEFAULT_INGREDIENT_NAME_TRANSLATIONS
  }
}

const normalizeIngredientNamesInResponse = (response = '') => {
  const translations = parseIngredientNameTranslations()
  return Object.entries(translations)
    .sort(([left], [right]) => right.length - left.length)
    .reduce((currentResponse, [sourceName, translatedName]) => {
      if (!sourceName || !translatedName) return currentResponse
      return currentResponse.replace(new RegExp(`\\b${escapeRegExp(sourceName)}\\b`, 'gi'), translatedName)
    }, response || '')
}

const normalizeProductRulesInResponse = (response = '') => {
  return normalizeOrderingChannelInResponse(normalizeProductSalesUnitInResponse(normalizeProductPosologyInResponse(normalizeProductFormFactorInResponse(response))))
}

const responsePolicyAvoidsSalesPush = (responsePolicy = {}) => {
  return Array.isArray(responsePolicy.mustAvoid) && responsePolicy.mustAvoid.includes('sales_push')
}

const responsePolicyMustAnswer = (responsePolicy = {}, topic = '') => {
  return Array.isArray(responsePolicy.mustAnswer) && responsePolicy.mustAnswer.includes(topic)
}

const responsePolicyMustNotRepeat = (responsePolicy = {}, topic = '') => {
  return Array.isArray(responsePolicy.mustNotRepeat) && responsePolicy.mustNotRepeat.includes(topic)
}

const responsePolicyHasDirectAnswerPriority = (responsePolicy = {}) => {
  return [
    'price',
    'information',
    'proof',
    'business_interest',
    'medical_safety',
    'composition',
    'usage',
    'delivery',
    'payment',
    'purchase',
    'order_confirmation'
  ].some((topic) => responsePolicyMustAnswer(responsePolicy, topic))
}

const hasPreviousOutboundMatching = (conversation = [], matcher = () => false) => {
  return (Array.isArray(conversation) ? conversation : [])
    .filter((conversationMessage) => conversationMessage.direction === 'outbound')
    .some((conversationMessage) => matcher(conversationMessage.message || ''))
}

const getLastOutboundMessage = (conversation = []) => {
  return [...(Array.isArray(conversation) ? conversation : [])]
    .reverse()
    .find((conversationMessage) => conversationMessage.direction === 'outbound')
    ?.message || ''
}

const buildNeutralFollowUpResponse = (conversation = []) => {
  return normalizeExactMessageForComparison(getLastOutboundMessage(conversation)) === normalizeExactMessageForComparison(NEUTRAL_FOLLOW_UP_RESPONSE)
    ? NEUTRAL_FOLLOW_UP_REPEAT_RESPONSE
    : NEUTRAL_FOLLOW_UP_RESPONSE
}

const countPreviousOutboundMatching = (conversation = [], matcher = () => false) => {
  return (Array.isArray(conversation) ? conversation : [])
    .filter((conversationMessage) => conversationMessage.direction === 'outbound')
    .filter((conversationMessage) => matcher(conversationMessage.message || ''))
    .length
}

const hasTotalHealingQuestion = (message = '') => {
  return /\bguerison\s+(?:totale|complete)\b/i.test(normalizeResponseForComparison(message))
}

const hasHealingSpecificConditionQuestion = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:est\s+ce\s+que\s+)?(?:ca|cela|ce\s+produits?|le\s+produit|miiracell)\s+(?:guerit|gueri|soigne|traite)\s+(?:aussi\s+)?(?:l['’ ]?|le\s+|la\s+|les\s+|mon\s+|ma\s+|mes\s+)?[a-z0-9]{3,}/.test(value) ||
    /\b(?:guerit|gueri|soigne|traite)\s+(?:aussi\s+)?(?:l['’ ]?|le\s+|la\s+|les\s+|mon\s+|ma\s+|mes\s+)?[a-z0-9]{3,}/.test(value)
}

const isMedicalSafetyContext = (conversationState = {}, responsePolicy = {}) => {
  return conversationState.currentIntent === 'health_condition_question' ||
    responsePolicy.nextBestAction === 'give_medical_safety_response_without_sales_push'
}

const normalizeResponseForComparison = (value = '') => {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/miira[\s-]?cell\+/g, 'miiracell')
    .replace(/\s+/g, ' ')
    .trim()
}

const normalizeExactMessageForComparison = (value = '') => {
  return normalizeResponseForComparison(value)
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const responseContainsPriceObjectionResponse = (response = '') => {
  return normalizeExactMessageForComparison(response).includes(normalizeExactMessageForComparison(PRICE_OBJECTION_RESPONSE))
}

const hasPriceObjectionResponseInConversation = (conversation = []) => {
  if (!Array.isArray(conversation)) return false

  return conversation.some((conversationMessage) => {
    return conversationMessage.direction === 'outbound' &&
      responseContainsPriceObjectionResponse(conversationMessage.message || '')
  })
}

const responseContainsProductPresentationPackChoiceResponse = (response = '') => {
  return normalizeExactMessageForComparison(response).includes(normalizeExactMessageForComparison(PRODUCT_PRESENTATION_PACK_CHOICE_RESPONSE))
}

const hasProductPresentationPackChoiceResponseInConversation = (conversation = []) => {
  if (!Array.isArray(conversation)) return false

  return conversation.some((conversationMessage) => {
    return conversationMessage.direction === 'outbound' &&
      responseContainsProductPresentationPackChoiceResponse(conversationMessage.message || '')
  })
}

const hasMedicalSafetyResponseInConversation = (conversation = []) => {
  if (!Array.isArray(conversation)) return false

  const normalizedMedicalSafetyResponse = normalizeExactMessageForComparison(MEDICAL_MENTION_BRONZE_RESPONSE)
  return conversation.some((conversationMessage) => {
    return conversationMessage.direction === 'outbound' &&
      normalizeExactMessageForComparison(conversationMessage.message || '').includes(normalizedMedicalSafetyResponse)
  })
}

const suppressRepeatedPriceObjectionResponse = (response = '', priceObjectionAlreadyHandled = false) => {
  if (!priceObjectionAlreadyHandled || !responseContainsPriceObjectionResponse(response)) return response

  const responseWithoutExactPriceObjection = String(response || '')
    .replace(PRICE_OBJECTION_RESPONSE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (responseWithoutExactPriceObjection && !responseContainsPriceObjectionResponse(responseWithoutExactPriceObjection)) {
    return responseWithoutExactPriceObjection
  }

  return "Je comprends. On peut avancer simplement: vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?"
}

const suppressRepeatedProductPresentationPackChoiceResponse = (response = '', productPresentationPackChoiceAlreadySent = false) => {
  if (!productPresentationPackChoiceAlreadySent || !responseContainsProductPresentationPackChoiceResponse(response)) return response

  const responseWithoutExactPresentation = String(response || '')
    .replace(PRODUCT_PRESENTATION_PACK_CHOICE_RESPONSE_PATTERN, '')
    .replace(/\s*Je viens de vous envoyer les audios et le document de pr[ée]sentation\.\s*/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (responseWithoutExactPresentation && !responseContainsProductPresentationPackChoiceResponse(responseWithoutExactPresentation)) {
    return responseWithoutExactPresentation
  }

  return "Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?"
}

const isPriceHighObjectionTurn = (currentObjections = []) => {
  return Array.isArray(currentObjections) && currentObjections.some((objection) => objection.id === 'price_high')
}

const normalizePriceObjectionResponse = (response = '', currentObjections = []) => {
  if (!isPriceHighObjectionTurn(currentObjections)) return response
  if (!responseContainsPriceObjectionResponse(response)) return response

  return PRICE_OBJECTION_RESPONSE
}

const markProductPresentationPackChoiceResponseAfterResponse = (sessionVariables = {}, response = '') => {
  if (!responseContainsProductPresentationPackChoiceResponse(response)) return sessionVariables

  return {
    ...sessionVariables,
    productPresentationPackChoiceResponseSent: 'true'
  }
}

const markBusinessInterestResponseAfterResponse = (sessionVariables = {}, response = '') => {
  const normalizedResponse = normalizeResponseForComparison(response)
  if (normalizeResponseForComparison(BUSINESS_RESELLER_CLARIFICATION_RESPONSE) === normalizedResponse) {
    return {
      ...sessionVariables,
      businessInterestClarificationSent: 'true'
    }
  }

  if (normalizeResponseForComparison(BUSINESS_RESELLER_FOLLOW_UP_RESPONSE) === normalizedResponse ||
    normalizeResponseForComparison(BUSINESS_RESELLER_CLIENT_THEN_RESELLER_RESPONSE) === normalizedResponse ||
    normalizeResponseForComparison(BUSINESS_RESELLER_BOTH_CASES_RESPONSE) === normalizedResponse ||
    normalizeResponseForComparison(BUSINESS_RESELLER_REPEAT_FOLLOW_UP_RESPONSE) === normalizedResponse ||
    normalizeResponseForComparison(BUSINESS_RESELLER_FINAL_FOLLOW_UP_RESPONSE) === normalizedResponse) {
    return {
      ...sessionVariables,
      businessInterestFollowUpSent: 'true'
    }
  }

  return sessionVariables
}

const markProofOrMediaOfferAfterResponse = (sessionVariables = {}, response = '') => {
  const normalizedResponse = normalizeResponseForComparison(response)
  if (/\b(?:visuel|visuels|temoignage|temoignages|support|supports)\b/.test(normalizedResponse) &&
    /\b(?:je peux vous envoyer|si vous souhaitez|souhaitez vous|voulez vous)\b/.test(normalizedResponse)) {
    return {
      ...sessionVariables,
      proofOrMediaOfferPending: 'true'
    }
  }

  if (/\b(?:je viens de vous envoyer|je vous ai deja envoye)\b/.test(normalizedResponse) &&
    /\b(?:support|supports|media|medias|video|videos|temoignage|temoignages)\b/.test(normalizedResponse)) {
    return {
      ...sessionVariables,
      proofOrMediaOfferPending: 'false'
    }
  }

  return sessionVariables
}

const finalizeSessionVariablesAfterResponse = (sessionVariables = {}, currentObjections = [], response = '') => {
  return markBusinessInterestResponseAfterResponse(
    markProofOrMediaOfferAfterResponse(
      markProductPresentationPackChoiceResponseAfterResponse(
        markHandledObjectionsAfterResponse(sessionVariables, currentObjections, response),
        response
      ),
      response
    ),
    response
  )
}

const hasConversationClosingPhrase = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:a bientot|au revoir|bye|goodbye|bonne journee|bonne soiree|bonne continuation|a la prochaine|merci et bonne journee|merci et bonne soiree)\b/.test(value)
}

const ensureWhatsAppGroupLinkDuringPresentation = (response = '', whatsappGroupLinkAlreadySent = false) => {
  if (!String(response || '').trim()) return response
  if (response.includes(WHATSAPP_GROUP_LINK)) return response
  if (whatsappGroupLinkAlreadySent) return response

  return `${response.trim()}\n\n${WHATSAPP_GROUP_PRESENTATION_MESSAGE}`
}

const isTrueSessionFlag = (value) => String(value || '').toLowerCase() === 'true'

const hasBusinessInterestClarificationInConversation = (conversation = []) => {
  return Array.isArray(conversation) && conversation.some((message) =>
    message?.direction === 'outbound' &&
    normalizeResponseForComparison(message.message).includes(normalizeResponseForComparison('Vous souhaitez rejoindre le groupe comme client'))
  )
}

const lastBusinessInterestResponseKind = (conversation = []) => {
  const lastOutbound = [...(Array.isArray(conversation) ? conversation : [])]
    .reverse()
    .find((message) => message?.direction === 'outbound')
    ?.message || ''
  const normalizedLastOutbound = normalizeResponseForComparison(lastOutbound)

  if (normalizedLastOutbound === normalizeResponseForComparison(BUSINESS_RESELLER_FOLLOW_UP_RESPONSE)) return 'follow_up'
  if (normalizedLastOutbound === normalizeResponseForComparison(BUSINESS_RESELLER_REPEAT_FOLLOW_UP_RESPONSE)) return 'repeat_follow_up'
  if (normalizedLastOutbound === normalizeResponseForComparison(BUSINESS_RESELLER_FINAL_FOLLOW_UP_RESPONSE)) return 'final_follow_up'
  return null
}

const shouldUseBusinessInterestFollowUp = (message = '', sessionVariables = {}, conversation = []) => {
  const value = normalizeResponseForComparison(message)
  const clarificationAlreadySent = isTrueSessionFlag(sessionVariables.businessInterestClarificationSent) ||
    hasBusinessInterestClarificationInConversation(conversation)
  return clarificationAlreadySent &&
    (/^(?:client\s+apres\s+revendeur|client\s+après\s+revendeur|partenaire|devenir\s+partenaire|revendeur|devenir\s+revendeur|des?\s+renseignements?|renseignements?)\.?$/.test(value) ||
      /\b(?:les\s+)?deux\s+cas\b.{0,40}\b(?:interesse|interessent|m'interesse|m'interessent)\b/.test(value) ||
      /\b(?:devenir|etre|être)\s+(?:partenaire|revendeur|revendeuse)\b/.test(value))
}

const buildBusinessInterestResponse = (message = '', sessionVariables = {}, conversation = []) => {
  if (!shouldUseBusinessInterestFollowUp(message, sessionVariables, conversation)) return BUSINESS_RESELLER_CLARIFICATION_RESPONSE

  if (/^client\s+apr[eè]s\s+revendeur\.?$/.test(normalizeResponseForComparison(message))) {
    return BUSINESS_RESELLER_CLIENT_THEN_RESELLER_RESPONSE
  }

  if (/\b(?:les\s+)?deux\s+cas\b.{0,40}\b(?:interesse|interessent|m'interesse|m'interessent)\b/.test(normalizeResponseForComparison(message))) {
    return BUSINESS_RESELLER_BOTH_CASES_RESPONSE
  }

  const lastResponseKind = lastBusinessInterestResponseKind(conversation)
  if (lastResponseKind === 'follow_up') return BUSINESS_RESELLER_REPEAT_FOLLOW_UP_RESPONSE
  if (lastResponseKind === 'repeat_follow_up') return BUSINESS_RESELLER_FINAL_FOLLOW_UP_RESPONSE

  return BUSINESS_RESELLER_FOLLOW_UP_RESPONSE
}

const sendWhatsAppGroupLinkAfterPresentation = async (destinationAddress) => {
  console.info('Sending Miira-Cell+ WhatsApp group link after presentation media', { destinationAddress })
  const groupLinkResponse = await WhatsAppService.sendWhatsAppMessage(
    destinationAddress,
    WHATSAPP_GROUP_PRESENTATION_MESSAGE,
    true
  )
  console.info('Miira-Cell+ WhatsApp group link response', groupLinkResponse)
  if (!groupLinkResponse?.messageId) throw new Error('WhatsApp group link send did not return a messageId')
  return groupLinkResponse.messageId
}

const hasOnlinePaymentRequest = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:mobile money|momo|wave|orange money|moov money|mtn money|visa|paiement en ligne|payer en ligne|lien de paiement|lien pour payer|payer par lien|paiement mobile|payer par mobile|payer par wave|payer par orange|payer par moov|payer par mtn)\b/.test(value)
}

const detectRequestedBoxQuantity = (message = '') => {
  const value = normalizeResponseForComparison(message)
  if (hasTreatmentQuantityQuestion(message) || hasPriceOrBudgetUsageQuestion(message)) return null
  if (/\b(?:1|un|une)\s*boites?\b/.test(value)) return 1
  if (/\b(?:2|deux)\s*boites?\b/.test(value)) return 2
  if (/\b(?:pack bronze|bronze|cure|2 boites?|deux boites?)\b/.test(value)) return 2
  if (/\b(?:pack starter|starter|1 boite|une boite|un boite)\b/.test(value)) return 1
  return null
}

const hasTreatmentQuantityQuestion = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:faut|falloir|necessaire|oblige|obligatoire|forcement|combien)\b.{0,100}\b(?:boites?|boite|traitement|cure)\b/.test(value) &&
    /\b(?:traitement|cure|traiter|soigner|guerir)\b/.test(value)
}

const hasPriceOrBudgetUsageQuestion = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return hasTreatmentQuantityQuestion(message) &&
    /\b(?:43\s*000|43000|43\s*k|fcfa|f\s*cfa|budget|cher|chere|prix|mine\s+de\s+rien)\b/.test(value)
}

const hasOneBoxBronzeCorrectionSignal = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:1|un|une)\s*boites?\b.{0,60}\b(?:pack bronze|bronze)\b/.test(value) ||
    /\b(?:pack bronze|bronze)\b.{0,60}\b(?:1|un|une)\s*boites?\b/.test(value)
}

const detectPaymentMode = (message = '') => {
  const value = normalizeResponseForComparison(message)
  if (/\ba la livraison\b/.test(value)) return 'paiement a la livraison'
  if (/\b(?:paiement|payement|payer|paie|payez|reglement)\b/.test(value) && /\b(?:livraison|a la livraison|cash|espece|especes)\b/.test(value)) return 'paiement a la livraison'
  if (/\b(?:mobile money|momo|wave|orange money|moov money|mtn money|visa|paiement en ligne|payer en ligne|lien de paiement|paiement mobile|payer par mobile|payer par wave|payer par orange|payer par moov|payer par mtn)\b/.test(value)) return 'paiement en ligne'
  return null
}

const asksForDeliveryLocation = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:ville|commune|quartier|lieu|adresse|ou souhaitez vous etre livre|ou voulez vous etre livre|livraison|livrer|livre)\b/.test(value) &&
    /\b(?:livraison|livrer|livre|ville|commune|quartier|adresse|lieu)\b/.test(value)
}

const isInvalidDeliveryLocationCandidate = (value = '') => {
  const normalizedValue = normalizeResponseForComparison(value)
  return !normalizedValue ||
    /\b\d{2,5}\s*k\b/.test(normalizedValue) ||
    /\b\d[\d\s.,]*(?:fcfa|f\s*cfa|xof)\b/.test(normalizedValue) ||
    /\b(?:ma|mon|mes|la|le|les|vos|votre)\s+(?:question|message|propos|produits?|efficacite|innocuite|vie)\b/.test(normalizedValue) ||
    /\b(?:question|message|propos|efficacite|innocuite|produits?|certification|brevet|traitement|traiter|efficacement|boites?|paquets?|packs?|sachets?|poudre|sujet|temps|combien|prix|cout|tarif|montant|myomes?|fibromes?|ulceres?|buruli|cet effet|livraison certainement|a la livraison|reduction|vente|commande|commander|achete|acheter|prendre|confirme|confirmer|valide|valider|bientot|incessamment|interesse|interessee|reveni?r|reviendrai)\b/.test(normalizedValue)
}

const extractDeliveryLocation = (message = '', previousOutboundMessage = '') => {
  const rawMessage = (message || '').trim()
  if (!rawMessage) return null

  const normalizedMessage = normalizeResponseForComparison(rawMessage)
  if (/\ba la livraison\b/.test(normalizedMessage) || /\b(?:payer|paiement|payement|paie|payez|reglement).{0,30}\ba la livraison\b/.test(normalizedMessage)) return null
  if (hasBoxContentQuestion(rawMessage)) return null

  if (rawMessage.includes('🇬🇳') || rawMessage.includes('ðŸ‡¬ðŸ‡³') || /\bguinee\b/.test(normalizedMessage)) return 'Guinee'
  if (/\b(?:ci|cote\s+d[’']?\s*ivoire|cote\s+divoire)\b/.test(normalizedMessage) && /\babidjan\b/.test(normalizedMessage)) return "Cote d'Ivoire"
  if (/\b(?:ci|cote\s+d[’']?\s*ivoire|cote\s+divoire)\b/.test(normalizedMessage)) return "Cote d'Ivoire"
  if (/\bport gentil\b/.test(normalizedMessage)) return 'Port-Gentil'

  const explicitLocationMatch = rawMessage.match(/\b(?:a|à|en|sur|vers|dans|de|je suis a|je suis à|je suis en|livrer a|livrer à|livraison a|livraison à|adresse(?: est)?|commune(?: est)?|quartier(?: est)?)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9' -]{2,80})/i)
  if (explicitLocationMatch?.[1]) {
    const candidate = explicitLocationMatch[1]
      .replace(/\b(?:jusqu['’ ]?a|jusqu a|avant|apres|après)\b.*$/i, '')
      .replace(/\b(?:au|contact|tel|telephone|numero)\s+\d[\d\s+.-]*.*$/i, '')
      .replace(/[.!?]+$/, '')
      .trim()
    return isInvalidDeliveryLocationCandidate(candidate) ? null : candidate
  }

  if (asksForDeliveryLocation(previousOutboundMessage) &&
    !/[?]/.test(rawMessage) &&
    rawMessage.length <= 80 &&
    !/\b(?:oui|non|ok|okay|daccord|d accord|commande|commander|achete|acheter|prendre|confirmer|confirme|valider|valide|bonjour|bonsoir|merci|combien|prix|cher|boites?|sachets?|mobile money|wave|orange money|moov|mtn|visa)\b/.test(normalizedMessage)) {
    return rawMessage.replace(/[.!?]+$/, '').trim()
  }

  return null
}

const getKnownProspectInfoFromSession = (sessionVariables = {}) => {
  return KNOWN_PROSPECT_INFO_FIELDS.reduce((knownInfo, field) => {
    const value = sessionVariables[field]
    if (value !== undefined && value !== null && String(value).trim()) {
      knownInfo[field] = String(value).trim()
    }
    return knownInfo
  }, {})
}

const CONTACT_EMAIL_REGEX = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i

const extractContactEmail = (message = '') => {
  const match = String(message || '').match(CONTACT_EMAIL_REGEX)
  return match ? match[0] : null
}

const extractContactPhone = (message = '') => {
  const candidates = String(message || '').match(/\+?\d[\d\s().-]{6,}\d/g) || []
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, '')
    if (digits.length >= 8 && digits.length <= 15) return candidate.trim()
  }
  return null
}

const extractContactName = (message = '', email = '', phone = '') => {
  let rest = String(message || '')
  if (email) rest = rest.split(email).join(' ')
  if (phone) rest = rest.split(phone).join(' ')
  rest = rest
    .replace(/\b(?:nom|prenom|prénom|email|e[-\s]?mail|adresse|tel|telephone|téléphone|numero|numéro|contact|mon|ma|est|suis|c['’ ]?est|je\s+m['’]?appelle|voici)\b\s*:?/gi, ' ')
    .replace(/[^\p{L}\s'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return rest && /\p{L}{2,}/u.test(rest) ? rest : null
}

// Detecte le message groupe de demande des infos de finalisation (buildContactAndDeliveryRequest).
const isContactAndDeliveryRequest = (previousOutboundMessage = '') =>
  /avant le recapitulatif, merci de m['’ ]?indiquer/.test(normalizeResponseForComparison(previousOutboundMessage))

// Nettoie un segment (retire mots-etiquettes et ponctuation parasite) en gardant lettres,
// chiffres, espaces, apostrophes et traits d'union.
const cleanInfoSegment = (segment = '') => String(segment || '')
  .replace(/\b(?:mon|ma|mes|le|la|les|c['’ ]?est|je\s+m['’]?appelle|voici|nom|prenom|prénom|email|e[-\s]?mail|adresse|tel|telephone|téléphone|numero|numéro|contact|lieu(?:\s+de)?|livraison|livrer|quartier|commune|ville)\b\s*:?/gi, ' ')
  .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Reponse groupee a la demande de finalisation: l'e-mail et le telephone sont auto-identifiants;
// pour le reste, on s'appuie sur l'ordre demande (lieu de livraison AVANT nom et prenom).
const parseGroupedContactAndDelivery = (message = '', previousOutboundMessage = '') => {
  const prevNorm = normalizeResponseForComparison(previousOutboundMessage)
  const requestedLocation = /lieu de livraison/.test(prevNorm)
  const requestedName = /nom et prenom|votre nom/.test(prevNorm)
  const email = extractContactEmail(message)
  const phone = extractContactPhone(message)

  let rest = String(message || '')
  if (email) rest = rest.split(email).join(' ')
  if (phone) rest = rest.split(phone).join(' ')

  const segments = rest
    .split(/[,;\n\r/]+/)
    .map((segment) => cleanInfoSegment(segment))
    .filter((segment) => segment && /\p{L}{2,}/u.test(segment))

  let location = null
  let name = null
  if (requestedLocation && requestedName) {
    location = segments[0] || null
    name = segments.slice(1).join(' ').trim() || null
  } else if (requestedLocation) {
    location = segments.join(' ').trim() || null
  } else if (requestedName) {
    name = segments.join(' ').trim() || null
  }

  return { location, name, email, phone }
}

const hasProspectOrderConfirmationSignal = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:je\s+)?(?:confirme|valide)\b.{0,25}\b(?:commande|achat)\b/.test(value) ||
    /\b(?:je\s+confirme|je\s+valide|c['’ ]?est\s+confirme)\b/.test(value)
}

// Le prospect valide explicitement le récapitulatif affiché (bouton RECAP_CONFIRM
// rendu par services/whatsappInteractive.mjs, ou saisie libre equivalente).
const hasOrderRecapConfirmationSignal = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:je\s+)?(?:valide|confirme)\b.{0,25}\brecapitulatif\b/.test(value)
}

const hasCompleteContactDetails = (knownProspectInfo = {}) => {
  return Boolean(knownProspectInfo.knownContactName) &&
    Boolean(knownProspectInfo.knownContactEmail) &&
    Boolean(knownProspectInfo.knownContactPhone)
}

const deriveKnownProspectInfo = (sessionVariables = {}, conversation = [], currentMessage = '') => {
  const knownInfo = getKnownProspectInfoFromSession(sessionVariables)
  let previousOutboundMessage = ''
  const turns = [
    ...(Array.isArray(conversation) ? conversation : []),
    { direction: 'inbound', message: currentMessage }
  ]

  for (const turn of turns) {
    const message = turn?.message || ''
    if (turn?.direction === 'outbound') {
      if (hasOrderValidationRequest(message)) knownInfo.orderValidationAsked = 'true'
      previousOutboundMessage = message
      continue
    }

    if (turn?.direction !== 'inbound') continue

    const quantity = detectRequestedBoxQuantity(message)
    const paymentMode = detectPaymentMode(message)

    if (quantity) knownInfo.knownBoxQuantity = `${quantity}`
    if (paymentMode) knownInfo.knownPaymentMode = paymentMode
    if (hasProspectOrderConfirmationSignal(message)) knownInfo.prospectConfirmedOrder = 'true'

    if (isContactAndDeliveryRequest(previousOutboundMessage)) {
      // Reponse groupee a la demande de finalisation: parsing structure (ordre demande),
      // pour ne pas confondre lieu de livraison et coordonnees.
      const parsed = parseGroupedContactAndDelivery(message, previousOutboundMessage)
      if (parsed.location) knownInfo.knownDeliveryLocation = parsed.location
      if (parsed.email) knownInfo.knownContactEmail = parsed.email
      if (parsed.phone) knownInfo.knownContactPhone = parsed.phone
      if (parsed.name) knownInfo.knownContactName = parsed.name
    } else {
      const deliveryLocation = extractDeliveryLocation(message, previousOutboundMessage)
      if (deliveryLocation) knownInfo.knownDeliveryLocation = deliveryLocation

      // Les coordonnees ne sont captees que si un e-mail est present (signal fort et non ambigu),
      // ce qui evite de confondre une adresse de livraison + contact avec des coordonnees.
      const email = extractContactEmail(message)
      if (email) {
        const phone = extractContactPhone(message)
        const name = extractContactName(message, email, phone)
        knownInfo.knownContactEmail = email
        if (phone) knownInfo.knownContactPhone = phone
        if (name) knownInfo.knownContactName = name
      }
    }
  }

  return knownInfo
}

const ensureOnlinePaymentLinkInResponse = (response = '', message = '', knownProspectInfo = {}) => {
  if (!hasOnlinePaymentRequest(message)) return response

  const requestedBoxQuantity = detectRequestedBoxQuantity(message) || Number(knownProspectInfo.knownBoxQuantity)
  const requiredPaymentLink = requestedBoxQuantity === 1
    ? ONE_BOX_PAYMENT_LINK
    : requestedBoxQuantity === 2
      ? TWO_BOX_PAYMENT_LINK
      : null

  if (!requiredPaymentLink) return response
  if ((response || '').includes(requiredPaymentLink)) return response

  return `${(response || '').trim()}\n\nLien de paiement: ${requiredPaymentLink}`.trim()
}

const splitResponseSentences = (value = '') => {
  return value.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) || []
}

const isRepeatedMediaFallbackSentence = (sentence, normalizedAgentCompletion) => {
  const normalizedSentence = normalizeResponseForComparison(sentence)

  if (normalizedAgentCompletion.includes(normalizedSentence)) return true

  const repeatsProductOverview = normalizedSentence.includes('miiracell est un complement alimentaire') &&
    normalizedAgentCompletion.includes('miiracell est un complement alimentaire')
  const repeatsBenefits = normalizedSentence.includes('regeneration cellulaire') &&
    normalizedSentence.includes('vitalite') &&
    normalizedSentence.includes('systeme immunitaire') &&
    normalizedAgentCompletion.includes('regeneration cellulaire') &&
    normalizedAgentCompletion.includes('vitalite') &&
    normalizedAgentCompletion.includes('systeme immunitaire')
  const repeatsPackChoice = normalizedSentence.includes('vous preferez commencer avec 1 boite') &&
    normalizedSentence.includes('faire la cure avec 2 boites') &&
    normalizedAgentCompletion.includes('vous preferez commencer avec 1 boite') &&
    normalizedAgentCompletion.includes('faire la cure avec 2 boites')
  const repeatsPackPrices = normalizedSentence.includes('43 000 fcfa') &&
    normalizedSentence.includes('86 000 fcfa') &&
    normalizedAgentCompletion.includes('43 000 fcfa') &&
    normalizedAgentCompletion.includes('86 000 fcfa')

  return repeatsProductOverview || repeatsBenefits || repeatsPackChoice || repeatsPackPrices
}

const getFunctionInvocationInput = (returnControl) => {
  return returnControl?.invocationInputs?.[0]?.functionInvocationInput
}

const getFunctionParameters = (functionInvocationInput) => {
  return Object.fromEntries(
    (functionInvocationInput?.parameters || []).map((parameter) => [parameter.name, parameter.value])
  )
}

const normalizeMediaType = (requestedMediaType) => {
  const value = (requestedMediaType || '').toLowerCase().trim()
  if (['all', 'tout', 'tous', 'toutes'].includes(value)) return 'all'
  if (['both', 'photo_video', 'photo+video', 'photo et video', 'photo et vidéo', 'photos et videos', 'photos et vidéos'].includes(value)) return 'both'
  if (['presentation', 'présentation', 'info', 'infos', 'information', 'informations'].includes(value)) return 'presentation'
  if (['document', 'pdf', 'brochure', 'fiche', 'catalogue'].includes(value)) return 'document'
  if (['treatment_image', 'traitement_image', 'image_traitement', 'traitement', 'maladies', 'maladie'].includes(value)) return 'treatment_image'
  if (['posology_video', 'posologie_video', 'posologie vidéo', 'video posologie', 'vidéo posologie', 'posologie'].includes(value)) return 'posology_video'
  if (['audio', 'vocal', 'vocaux', 'note vocale', 'message vocal', 'ogg'].includes(value)) return 'audio'
  if (['video', 'videos', 'vidéo', 'vidéos'].includes(value)) return 'video'
  return 'photo'
}

const parseMediaUrls = (...values) => {
  return values
    .flatMap((value) => (value || '').split(','))
    .map((mediaUrl) => mediaUrl.trim())
    .filter((mediaUrl) => mediaUrl && mediaUrl !== 'not-defined')
}

const getMediaDedupeKey = (mediaUrl = '') => String(mediaUrl || '').trim().toLowerCase()

const normalizeSentProductMedia = (sentProductMedia = []) => {
  if (Array.isArray(sentProductMedia)) return sentProductMedia.filter((item) => getMediaDedupeKey(item?.mediaUrl))
  if (typeof sentProductMedia !== 'string' || !sentProductMedia.trim()) return []

  try {
    const parsed = JSON.parse(sentProductMedia)
    return Array.isArray(parsed) ? parsed.filter((item) => getMediaDedupeKey(item?.mediaUrl)) : []
  } catch (_error) {
    return sentProductMedia
      .split(',')
      .map((mediaUrl) => ({ mediaUrl: mediaUrl.trim() }))
      .filter((item) => getMediaDedupeKey(item.mediaUrl))
  }
}

const getSentProductMediaKeys = (sentProductMedia = []) => {
  return new Set(normalizeSentProductMedia(sentProductMedia).map((item) => getMediaDedupeKey(item.mediaUrl)))
}

const getUnsentMediaUrls = (mediaUrls = [], sentProductMediaKeys = new Set(), skippedMedia = [], type = 'media') => {
  const unsentMediaUrls = []

  for (const mediaUrl of mediaUrls) {
    const mediaKey = getMediaDedupeKey(mediaUrl)
    if (!mediaKey || sentProductMediaKeys.has(mediaKey)) {
      skippedMedia.push({ type, mediaUrl, reason: 'already_sent' })
      continue
    }

    sentProductMediaKeys.add(mediaKey)
    unsentMediaUrls.push(mediaUrl)
  }

  return unsentMediaUrls
}

const mergeSentProductMedia = (sentProductMedia = [], newSentMedia = []) => {
  const merged = normalizeSentProductMedia(sentProductMedia)
  const mediaKeys = getSentProductMediaKeys(merged)

  for (const sentMedia of newSentMedia || []) {
    const mediaKey = getMediaDedupeKey(sentMedia?.mediaUrl)
    if (!mediaKey || mediaKeys.has(mediaKey)) continue
    merged.push({
      type: sentMedia.type,
      mediaUrl: sentMedia.mediaUrl,
      messageId: sentMedia.messageId,
      sentAt: sentMedia.sentAt || new Date().toISOString()
    })
    mediaKeys.add(mediaKey)
  }

  return merged
}

const serializeSentProductMedia = (sentProductMedia = []) => JSON.stringify(normalizeSentProductMedia(sentProductMedia))

const PRESENTATION_AUDIO_URLS = [
  'https://cdn.miiracell.ci/presentation-2.ogg',
  'https://cdn.miiracell.ci/presentation-1.ogg'
]
const PRESENTATION_DOCUMENT_URL = 'https://cdn.miiracell.ci/revoobit-presentation.pdf'

const buildEvaluationSentMedia = (requestedMediaType = 'media') => {
  if (requestedMediaType === 'presentation') {
    return [
      ...PRESENTATION_AUDIO_URLS.map((mediaUrl, index) => ({
        type: 'audio',
        mediaUrl,
        messageId: `evaluation-audio-${index + 1}`
      })),
      { type: 'document', mediaUrl: PRESENTATION_DOCUMENT_URL, messageId: 'evaluation-document' }
    ]
  }

  return [
    { type: requestedMediaType, mediaUrl: `evaluation://miiracell/${requestedMediaType}`, messageId: `evaluation-${requestedMediaType}` }
  ]
}

const getMaxItems = (maxItems) => {
  const parsedMaxItems = Number(maxItems)
  if (Number.isInteger(parsedMaxItems) && parsedMaxItems > 0) return Math.min(parsedMaxItems, 6)
  return 3
}

const getProspectSessionAttributes = (sessionVariables = {}) => {
  return [...PROSPECT_SESSION_FIELDS, ...KNOWN_PROSPECT_INFO_FIELDS].reduce((attributes, field) => {
    const value = sessionVariables[field]
    if (value !== undefined && value !== null && String(value).trim()) {
      attributes[field] = String(value)
    }
    return attributes
  }, {})
}

const getDestinationAddress = (parameters, recipient) => {
  const parameterAddress = (parameters.whatsappNumber || '').trim()
  if (parameterAddress && parameterAddress.toLowerCase() !== 'non fourni') return parameterAddress
  return recipient.destinationAddress
}

const deriveSiblingMediaUrl = (mediaUrls, filename) => {
  const firstMediaUrl = mediaUrls[0]
  if (!firstMediaUrl) return null

  try {
    const url = new URL(firstMediaUrl)
    url.pathname = url.pathname.replace(/[^/]*$/, filename)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch (error) {
    console.warn('Unable to derive sibling media URL', { firstMediaUrl, filename, error: error?.message })
    return null
  }
}

const detectRequestedMediaType = (message = '') => {
  const value = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const asksWhichDiseases = /(quelle?s?.*maladie?s?|maladie?s?.*(soigne|gueri|guerit|guerri|trait|traite)|soigne.*quelle?s?.*maladie?s?|gueri.*quelle?s?.*maladie?s?)/.test(value)
  const asksForAll = /\b(tout|tous|toutes)\b/.test(value) && /(photo|image|visuel|video|audio|vocal)/.test(value)
  const asksForPhoto = /(photo|photos|image|images|visuel|visuels|voir.*produit|voir.*boite|montrez.*produit)/.test(value)
  const asksForVideo = /(video|videos)/.test(value)
  const asksForAudio = /(audio|audios|vocal|vocaux|note vocale|message vocal|ecouter|ogg)/.test(value)
  const asksForGeneralInfo = /(infos?|information|informations|en savoir plus|plus d'info|plus dinfo|a ce sujet|ce sujet)/.test(value)
  const asksForPosology = /(posologie|dosage|dose|doses|doser|dosee|quantite|frequence|rythme|mode d'emploi|mode demploi|notice|utilisation|comment.*prendre|comment.*utiliser|comment.*boire|comment.*consommer|comment.*prise|prise.*comment|prise.*fait.*comment|la prise se fait comment|prendre.*produit|utiliser.*produit|consommer.*produit|combien.*prendre|combien.*utiliser|combien.*consommer|combien.*sachets?|sachets?.*(par|\/).*jour|sachets?.*quotidien|sachets?.*matin|sachets?.*soir|un ou deux sachets?|1 ou 2 sachets?|matin.*soir|soir.*matin|a jeun|à jeun|sous la langue|pendant combien.*jour|combien.*jour.*cure|duree.*cure|durer.*cure|24 jours)/.test(value)

  if (asksWhichDiseases) return 'treatment_image'
  if (asksForPosology) return 'posology_video'
  if (asksForAll) return 'all'
  if (asksForAudio) return 'audio'
  if (asksForPhoto && asksForVideo) return 'both'
  if (asksForVideo) return 'video'
  if (asksForPhoto) return 'photo'
  if (asksForGeneralInfo) return 'presentation'
  return null
}

const hasExplicitMedicalMention = (message = '') => {
  const value = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return /\b(glaucome|cancer|vih|sida|diabete|glycemie|arthrose|pathologie|pathologies|maladie|maladies|foie|rein|reins|renal|renaux|ulceres?)\b/.test(value)
}

const hasHealingOrPathologyQuestion = (message = '') => {
  const value = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return hasExplicitMedicalMention(message) ||
    hasHealingSpecificConditionQuestion(message) ||
    hasTotalHealingQuestion(message) ||
    /\b(?:guerir|gueri|guerit|soigne|traiter|disparaitre|disparait|aider)\b/.test(value)
}

const hasMembershipQuestion = (message = '') => {
  const value = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const asksAboutMembership = /\b(inscription|inscrire|adhesion|adherer|membre|membership)\b/.test(value)
  const asksAboutPartnerStatus = /\bpartenaire\b/.test(value) && /\b(devenir|etre|statut|revoobit|inscription|adhesion|membre)\b/.test(value)
  return asksAboutMembership || asksAboutPartnerStatus
}

const hasProductAvailabilityQuestion = (message = '') => {
  const value = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const targetsProduct = /\b(produit|miira[\s-]?cell|miiracell|complement)\b/.test(value)
  const asksWhereToGet = /\bou\s+(?:peut(?:-|\s*)on|puis-je|pourrais-je|je\s+peux|on\s+peut).{0,40}\b(?:avoir|trouver|acheter|commander|prendre|se\s+procurer|obtenir)\b/.test(value) ||
    /\bou\s+(?:avoir|trouver|acheter|commander|prendre|se\s+procurer|obtenir)\b/.test(value) ||
    /\b(?:avoir|trouver|acheter|commander|prendre|se\s+procurer|obtenir).{0,40}\bou\b/.test(value) ||
    /\bou\s+(?:est|sont)\s+(?:vendu|vendus|disponible|disponibles)\b/.test(value)

  return targetsProduct && asksWhereToGet
}

const hasAiSuspicion = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:ia|intelligence artificielle|robot|bot|automate)\b/.test(value)
}

const hasInappropriateAdultContent = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:porno|pornographique|sexe|sexuel|sexuelle|nude|nu|nue|nues|xxx)\b/.test(value)
}

const hasLowInformationOrUnclearMessage = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /^(?:cc|coucou|bjr|bsr|bonjour|bonsoir|slt|hello|hi)(?:\s+(?:mr|mme|monsieur|madame|docteur|doc|chef|patron))?\s*[!.?]*$/.test(value) ||
    /\bje suis un militaire a la retraite\b/.test(value) ||
    /\bavec moi et toi tu fais\b/.test(value)
}

const hasExternalPromotionMessage = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:delivery|livraison express|colis a livrer|repas a recevoir|courses a faire livrer|commandes? et infos?)\b/.test(value) &&
    !/\b(?:miiracell|miracell|revoobit)\b/.test(value)
}

const hasAntiHardSellQuestioning = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\bavant de (?:me )?demander si je veux commander\b/.test(value) ||
    (/\b(?:d'autres?|mes) questions?\b/.test(value) && /\b(?:commander|commande|sante|cure)\b/.test(value)) ||
    (/\bsituation de sante\b/.test(value) && /\b(?:questions?|commander|commande|cure)\b/.test(value))
}

const hasCertificationOrSafetyProofQuestion = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:garantie|garanti|efficacite|innocuite|brevet|certification|certifie|certifiee|tests?|risque|vie)\b/.test(value)
}

const hasVideoRequest = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:video|videos)\b/.test(value)
}

const hasCoteDIvoireContext = (message = '', knownProspectInfo = {}, conversationState = {}) => {
  const values = [
    message,
    knownProspectInfo.knownDeliveryLocation,
    conversationState.knownProspectInfo?.deliveryLocation
  ].filter(Boolean).join(' ')
  const value = normalizeResponseForComparison(values)
  return /\b(?:cote d ivoire|ci)\b/.test(value)
}

const buildMedicalSafetyResponse = () => MEDICAL_MENTION_BRONZE_RESPONSE

const hasGabonContext = (message = '', knownProspectInfo = {}, conversationState = {}) => {
  const values = [
    message,
    knownProspectInfo.knownDeliveryLocation,
    conversationState.knownProspectInfo?.deliveryLocation
  ].filter(Boolean).join(' ')
  return /\bgabon\b/.test(normalizeResponseForComparison(values))
}

const buildGabonDeliveryResponse = (conversation = []) => {
  const priorGabonDeliveryResponses = countPreviousOutboundMatching(conversation, (message) => {
    const normalizedMessage = normalizeResponseForComparison(message)
    return normalizedMessage.includes('representation au gabon') ||
      normalizedMessage.includes('possible au gabon') ||
      normalizedMessage.includes('livraison est coordonnee au gabon')
  })

  if (priorGabonDeliveryResponses >= 2) return GABON_DELIVERY_REPEAT_RESPONSE
  if (priorGabonDeliveryResponses === 1) return GABON_DELIVERY_FOLLOW_UP_RESPONSE
  return GABON_DELIVERY_DIRECT_RESPONSE
}

const extractKnownDeliveryLabel = (message = '', knownProspectInfo = {}, conversationState = {}) => {
  const values = [
    knownProspectInfo.knownDeliveryLocation,
    conversationState.knownProspectInfo?.deliveryLocation,
    message
  ].filter(Boolean).join(' ')
  const value = normalizeResponseForComparison(values)

  if (/\bplateau\b/.test(value)) return 'Plateau'
  if (/\byopougon\b/.test(value)) return 'Yopougon'
  if (/\bcocody\b/.test(value)) return 'Cocody'
  if (/\babidjan\b/.test(value)) return 'Abidjan'
  return knownProspectInfo.knownDeliveryLocation || conversationState.knownProspectInfo?.deliveryLocation || null
}

const buildLocalDeliveryDetailsResponse = (message = '', knownProspectInfo = {}, conversationState = {}) => {
  const deliveryLabel = extractKnownDeliveryLabel(message, knownProspectInfo, conversationState)
  const quantity = knownProspectInfo.knownBoxQuantity || conversationState.knownProspectInfo?.quantity
  const orderPart = quantity ? ` pour votre commande de ${quantity} boîte${Number(quantity) > 1 ? 's' : ''}` : ''
  const locationPart = deliveryLabel ? ` à ${deliveryLabel}` : ''
  return `Bien noté${orderPart}${locationPart}. Pour finaliser, vous pouvez payer à la livraison ou par Mobile Money.`
}

const hasBusinessLocationQuestion = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:ou|adresse|situe|situes|local|bureau|agence|boutique)\b/.test(value) &&
    /\b(?:vous|votre|etes|sommes|envoyer|passer|venir|aller|fils|fille|quelquun|quelqu un)\b/.test(value)
}

const GABON_COUNTRY_CODE = '241'

const isGabonPhoneNumber = (phoneNumber = '') => {
  const digits = String(phoneNumber || '').replace(/\D/g, '').replace(/^0+/, '')
  return digits.startsWith(GABON_COUNTRY_CODE)
}

const buildQuantitySelectedResponse = (knownProspectInfo = {}, conversationState = {}) => {
  const quantity = knownProspectInfo.knownBoxQuantity || conversationState.knownProspectInfo?.quantity
  const location = knownProspectInfo.knownDeliveryLocation || conversationState.knownProspectInfo?.deliveryLocation
  const orderValidationAsked = knownProspectInfo.orderValidationAsked === 'true'

  if (quantity && location && orderValidationAsked) {
    return buildOrderConfirmationResponse(knownProspectInfo, conversationState)
  }

  if (Number(quantity) === 2) {
    return 'Bien noté pour 2 boîtes de Miira-Cell+, soit 86 000 FCFA. Vous confirmez cette commande ?'
  }
  if (Number(quantity) === 1) {
    return 'Bien noté pour 1 boîte de Miira-Cell+, soit 43 000 FCFA. Vous confirmez cette commande ?'
  }
  return null
}

const buildOrderConfirmationResponse = (knownProspectInfo = {}, conversationState = {}) => {
  const quantity = knownProspectInfo.knownBoxQuantity || conversationState.knownProspectInfo?.quantity
  const location = knownProspectInfo.knownDeliveryLocation || conversationState.knownProspectInfo?.deliveryLocation
  const paymentMode = knownProspectInfo.knownPaymentMode || conversationState.knownProspectInfo?.paymentMode
  const price = Number(quantity) === 2
    ? '86 000 FCFA'
    : Number(quantity) === 1 ? '43 000 FCFA' : null
  const quantityPart = quantity ? `${quantity} boîte${Number(quantity) > 1 ? 's' : ''}` : 'votre commande'
  const pricePart = price ? `, total ${price}` : ''
  const locationPart = location ? `, livraison: ${location}` : ''
  const confirmed = `Commande confirmée pour ${quantityPart}${pricePart}${locationPart}.`

  // Tant que le mode de paiement n'est pas choisi, proposer le choix. La phrase
  // "payer à la livraison ou par Mobile Money" est rendue en boutons (PAY_COD / PAY_MOMO)
  // par la couche WhatsApp interactive (services/whatsappInteractive.mjs).
  if (!paymentMode) {
    return `${confirmed} Vous pouvez payer à la livraison ou par Mobile Money.`
  }

  // Mode déjà choisi: confirmer le mode retenu (lien de paiement si paiement en ligne).
  if (paymentMode === 'cash_on_delivery' || paymentMode === 'paiement a la livraison') {
    return `${confirmed} Paiement à la livraison: l'équipe vous contacte pour vous livrer.`
  }
  const paymentLink = Number(quantity) === 2
    ? TWO_BOX_PAYMENT_LINK
    : Number(quantity) === 1 ? ONE_BOX_PAYMENT_LINK : null
  return paymentLink
    ? `${confirmed} Voici le lien pour payer par Mobile Money: ${paymentLink}.`
    : `${confirmed} Vous pouvez payer à la livraison ou par Mobile Money.`
}

const buildOrderRecapResponse = (knownProspectInfo = {}, conversationState = {}) => {
  const quantity = knownProspectInfo.knownBoxQuantity || conversationState.knownProspectInfo?.quantity
  const location = knownProspectInfo.knownDeliveryLocation || conversationState.knownProspectInfo?.deliveryLocation
  const paymentMode = knownProspectInfo.knownPaymentMode || conversationState.knownProspectInfo?.paymentMode
  const price = Number(quantity) === 2
    ? '86 000 FCFA'
    : Number(quantity) === 1 ? '43 000 FCFA' : null
  const paymentLabel = (paymentMode === 'paiement a la livraison' || paymentMode === 'cash_on_delivery')
    ? 'à la livraison'
    : paymentMode ? 'par Mobile Money' : 'à préciser'
  const quantityPart = quantity ? `${quantity} boîte${Number(quantity) > 1 ? 's' : ''}` : 'votre commande'
  const pricePart = price ? ` pour un montant de ${price}` : ''
  const namePart = knownProspectInfo.knownContactName ? ` au nom de ${knownProspectInfo.knownContactName}` : ''
  const phonePart = knownProspectInfo.knownContactPhone ? ` (téléphone: ${knownProspectInfo.knownContactPhone}` : ''
  const emailPart = knownProspectInfo.knownContactEmail
    ? `${phonePart ? ', ' : ' ('}e-mail: ${knownProspectInfo.knownContactEmail})`
    : phonePart ? ')' : ''
  const contactPart = `${phonePart}${emailPart}`
  const locationPart = location ? `, à livrer à ${location}` : ''
  const recap = `Voici le récapitulatif de votre commande Miira-Cell+: ${quantityPart}${pricePart}${namePart}${contactPart}${locationPart}, avec un paiement ${paymentLabel}.`
  return `${recap} Confirmez-vous ce récapitulatif pour finaliser votre commande?`
}

// Une fois le mode de paiement choisi, on collecte le lieu de livraison et les
// coordonnees (nom, prenom, e-mail, telephone) manquants AVANT le recapitulatif.
const buildContactAndDeliveryRequest = (knownProspectInfo = {}, conversationState = {}) => {
  const paymentMode = knownProspectInfo.knownPaymentMode || conversationState.knownProspectInfo?.paymentMode
  const paymentLabel = (paymentMode === 'paiement a la livraison' || paymentMode === 'cash_on_delivery')
    ? 'à la livraison'
    : paymentMode ? 'par Mobile Money' : null
  const location = knownProspectInfo.knownDeliveryLocation || conversationState.knownProspectInfo?.deliveryLocation
  const missing = [
    location ? null : 'votre lieu de livraison',
    knownProspectInfo.knownContactName ? null : 'votre nom et prénom',
    knownProspectInfo.knownContactEmail ? null : 'votre adresse e-mail',
    knownProspectInfo.knownContactPhone ? null : 'votre numéro de téléphone'
  ].filter(Boolean)
  const intro = paymentLabel
    ? `C'est noté pour le paiement ${paymentLabel}.`
    : "C'est noté pour votre commande."
  return `${intro} Avant le récapitulatif, merci de m'indiquer, séparés par des virgules et dans cet ordre: ${missing.join(', ')}.`
}

const buildPaymentDetailsResponse = (message = '', knownProspectInfo = {}, conversationState = {}) => {
  const paymentMode = detectPaymentMode(message) || knownProspectInfo.knownPaymentMode || conversationState.knownProspectInfo?.paymentMode
  const quantity = knownProspectInfo.knownBoxQuantity || conversationState.knownProspectInfo?.quantity
  const location = knownProspectInfo.knownDeliveryLocation || conversationState.knownProspectInfo?.deliveryLocation
  const knownDetails = [
    quantity ? `${quantity} boîte${Number(quantity) > 1 ? 's' : ''}` : null,
    location ? `livraison: ${location}` : null
  ].filter(Boolean).join(', ')

  if (paymentMode === 'paiement a la livraison' || paymentMode === 'cash_on_delivery') {
    return `C'est noté: paiement à la livraison${knownDetails ? ` (${knownDetails})` : ''}. L'équipe peut finaliser votre commande.`
  }

  return `C'est noté pour le mode de paiement${knownDetails ? ` (${knownDetails})` : ''}. L'équipe peut finaliser votre commande.`
}

const buildDeliveryFollowUpResponse = (message = '', knownProspectInfo = {}, conversationState = {}) => {
  const deliveryLabel = extractKnownDeliveryLabel(message, knownProspectInfo, conversationState)
  const timeMatch = normalizeResponseForComparison(message).match(/\b(\d{1,2})\s*h\b/)
  const timePart = timeMatch ? ` avant ${timeMatch[1]}h` : ''
  const locationPart = deliveryLabel ? ` au ${deliveryLabel}` : ''
  return `Je comprends. Je relance le suivi de votre commande${locationPart}${timePart} avec l'équipe de livraison.`
}

const hasDirectDeliveryQuestion = (message = '') => {
  const value = normalizeResponseForComparison(message)
  return /\b(?:livraison|livraisons|livrer|livrez|livre|livrez-vous|faites\s+des\s+livraisons)\b/.test(value)
}

const buildProofSafetyResponse = (conversation = []) => {
  return hasPreviousOutboundMatching(conversation, (message) => normalizeResponseForComparison(message).includes('inventer de brevet'))
    ? PROOF_SAFETY_FOLLOW_UP_RESPONSE
    : PROOF_SAFETY_RESPONSE
}

const hasGabonRepresentationQuestion = (message = '') => {
  const value = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const mentionsGabon = /\bgabon\b/.test(value)
  const asksRepresentation = /\b(representation|representant|represente|representes|agence|bureau|presence|point\s+de\s+vente)\b/.test(value)

  return mentionsGabon && asksRepresentation
}

const hasOneBoxPriceQuestion = (message = '') => {
  const value = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const asksPrice = /\b(?:prix|tarif|cout|coute|montant)\b/.test(value) ||
    /\bfait\s+combien\b/.test(value) ||
    /\bcombien\b.{0,20}\b(?:coute|fait)\b/.test(value)
  const targetsOneBox = /\b(?:une?|1)\s+boite\b/.test(value) ||
    /\bboite\b.{0,30}\b(?:prix|tarif|cout|coute|fait|montant)\b/.test(value) ||
    /\b(?:prix|tarif|cout|coute|montant)\b.{0,30}\bboite\b/.test(value)

  return asksPrice && targetsOneBox
}

const hasBoxContentQuestion = (message = '') => {
  const value = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/\b(?:une?|la)\s+boite\s+contient\s+combien\s+de\s+(?:comprimes?|tablettes?|gelules?|capsules?)\b/.test(value)) return true
  if (/\bcombien\s+de\s+(?:comprimes?|tablettes?|gelules?|capsules?)\s+(?:contient|dans)\s+(?:une?|la)\s+boite\b/.test(value)) return true
  return /\b(?:une?|la)\s+boite\s+contient\s+combien\s+de\s+sachets?\b/.test(value) ||
    /\b(?:elle|la\s+boite)\s+contient\s+combien\s+de\s+sachets?\b/.test(value) ||
    /\bcombien\s+de\s+sachets?\s+(?:contient|dans)\s+(?:une?|la)\s+boite\b/.test(value) ||
    /\b(?:combien\s+de\s+sachets?\s+par\s+boite|sachets?\s+par\s+boite|contenu\s+de\s+la\s+boite|dans\s+la\s+boite)\b/.test(value)
}

const hasIngredientCompositionQuestion = (message = '') => {
  const value = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const asksAboutIngredients = /(ingredient|ingredients|composition|compose|composent|composants|contient|contenu|formule)/.test(value)
  const targetsMiiracell = /(miira[\s-]?cell|miiracell|produit|complement)/.test(value)
  const mentionsThirteen = /\b13\b|treize/.test(value)

  return asksAboutIngredients && (targetsMiiracell || mentionsThirteen)
}

const buildIngredientKnowledgeBaseUseCase = (useCase = {}) => {
  const knowledgeBaseId = process.env.MIIRACELL_INGREDIENT_KNOWLEDGE_BASE_ID || useCase.knowledgeBaseId
  const modelId = process.env.MIIRACELL_INGREDIENT_KB_MODEL_ID || useCase.modelId || 'amazon.nova-lite-v1:0'
  const sourceFilenameToken = process.env.MIIRACELL_INGREDIENT_SOURCE_FILENAME_TOKEN || INGREDIENTS_SOURCE_FILENAME_TOKEN

  if (!knowledgeBaseId) return null

  return {
    ...useCase,
    knowledgeBaseId,
    modelId,
    llmMaxTokens: process.env.MIIRACELL_INGREDIENT_KB_MAX_TOKENS || useCase.llmMaxTokens || '300',
    llmTemperature: process.env.MIIRACELL_INGREDIENT_KB_TEMPERATURE || useCase.llmTemperature || '0',
    promptTemplate: process.env.MIIRACELL_INGREDIENT_KB_PROMPT_TEMPLATE || `Tu réponds à un prospect WhatsApp de Miira-Cell+ en français.

Tu dois utiliser uniquement les résultats extraits du fichier PDF dont le nom contient "${sourceFilenameToken}" dans la base de connaissance. Ne réponds pas de mémoire et n'invente aucun ingrédient.
${PRODUCT_FORM_FACTOR_RULE}
${PRODUCT_SALES_UNIT_RULE}
Traduis obligatoirement en français le nom de chaque ingrédient avant de répondre au prospect. N'envoie pas de liste d'ingrédients en anglais. Si un nom botanique latin est nécessaire pour éviter l'ambiguïté, donne d'abord le nom français, puis le nom latin entre parenthèses.

Si les résultats ne viennent pas du PDF "${sourceFilenameToken}" ou ne donnent pas la liste exacte des 13 ingrédients qui composent Miira-Cell+, réponds exactement:
"${INGREDIENTS_KB_NOT_FOUND_RESPONSE}"

Si la liste est trouvée, réponds en 2 à 4 phrases maximum, avec les 13 ingrédients sous forme de liste courte, puis termine par une question commerciale simple.

Résultats PDF extraits:
$search_results$

$output_format_instructions$

Question du prospect:
$query$`
  }
}

const answerIngredientCompositionFromKnowledgeBase = async (message, useCase, sessionId) => {
  const ingredientKnowledgeBaseUseCase = buildIngredientKnowledgeBaseUseCase(useCase)

  if (!ingredientKnowledgeBaseUseCase) {
    console.warn('Ingredient composition question detected but no knowledge base id is configured')
    return INGREDIENTS_KB_NOT_CONFIGURED_RESPONSE
  }

  const sourceFilenameToken = process.env.MIIRACELL_INGREDIENT_SOURCE_FILENAME_TOKEN || INGREDIENTS_SOURCE_FILENAME_TOKEN
  const knowledgeBasePrompt = `Parcours uniquement le fichier PDF dont le nom contient "${sourceFilenameToken}" dans la base de connaissance et trouve la liste exacte des 13 ingrédients qui composent Miira-Cell+. N'utilise aucun autre PDF. Traduis le nom de chaque ingrédient en français avant de répondre au prospect. Question du prospect: ${message}`
  const retrieveResponse = await BedrockService.retrieveAndGenerate(knowledgeBasePrompt, ingredientKnowledgeBaseUseCase).catch((error) => {
    console.error('Ingredient composition knowledge base lookup failed', {
      name: error?.name,
      message: error?.message,
      knowledgeBaseId: ingredientKnowledgeBaseUseCase.knowledgeBaseId
    })
    return null
  })

  if (!retrieveResponse) return INGREDIENTS_KB_UNAVAILABLE_RESPONSE

  const retrievedReferences = retrieveResponse?.citations?.flatMap((citation) => citation.retrievedReferences || []) || []
  const responseText = retrieveResponse?.output?.text?.trim()
  const hasRevoobitSource = retrievedReferences.some((reference) => {
    const sourceUri = reference?.location?.s3Location?.uri || reference?.metadata?.['x-amz-bedrock-kb-source-uri'] || ''
    return sourceUri.toUpperCase().includes(sourceFilenameToken.toUpperCase())
  })

  if (!responseText || !retrievedReferences.length || !hasRevoobitSource || responseText.includes(INGREDIENTS_KB_NOT_FOUND_RESPONSE)) {
    return INGREDIENTS_KB_NOT_FOUND_RESPONSE
  }

  return normalizeProductRulesInResponse(normalizeIngredientNamesInResponse(responseText))
}

const hasPriorMediaClosing = (conversation = []) => {
  return conversation.some((message) => {
    if (message.direction !== 'outbound') return false

    const text = normalizeResponseForComparison(message.message || '')
    return text.includes('je viens de vous envoyer les medias. vous preferez commencer avec 1 boite ou faire la cure avec 2 boites ?') ||
      text.includes('je viens de vous envoyer les visuels. vous preferez commencer avec 1 boite ou faire la cure avec 2 boites ?') ||
      text.includes('je viens de vous envoyer les medias. miiracell est un complement alimentaire naturel') ||
      text.includes('je viens de vous envoyer les visuels. miiracell est un complement alimentaire naturel')
  })
}

const buildMediaFallbackResponse = (responsePayload, conversation = [], whatsappGroupLinkAlreadySent = false) => {
  if (!responsePayload?.success) {
    return "Je vais vous l'envoyer autrement. Vous préférez recevoir la photo, la vidéo ou l'audio ?"
  }

  if (responsePayload.alreadySent) {
    return "Je vous ai déjà envoyé ce média. Je reste disponible si vous souhaitez une précision sur Miira-Cell+."
  }

  if (responsePayload.requestedMediaType === 'presentation') {
    if (hasPriorMediaClosing(conversation)) {
      return "Je vous ai déjà envoyé les audios et le document de présentation. Je reste disponible si vous souhaitez une précision sur Miira-Cell+."
    }

    return ensureWhatsAppGroupLinkDuringPresentation(
      "Je viens de vous envoyer les audios et le document de présentation. Miira-Cell+ est un complément alimentaire naturel à base de cellules souches de pomme, avec 13 ingrédients actifs. Il aide à soutenir la régénération cellulaire, la vitalité et le système immunitaire. Vous préférez commencer avec 1 boîte à 43 000 FCFA ou faire la cure avec 2 boîtes à 86 000 FCFA ?",
      whatsappGroupLinkAlreadySent
    )
  }

  if (responsePayload.requestedMediaType === 'treatment_image') {
    return "Je viens de vous envoyer l'image. Miira-Cell+ est un complément alimentaire, il ne remplace pas un traitement médical. Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?"
  }

  if (responsePayload.requestedMediaType === 'posology_video') {
    return `Je viens de vous envoyer la vidéo de posologie. ${PRODUCT_POSOLOGY_RESPONSE} Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?`
  }

  const sentCount = responsePayload.sentMedia?.length || 0
  if (sentCount > 1) {
    if (hasPriorMediaClosing(conversation)) {
      return "C'est bien envoyé. Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?"
    }

    return "Je viens de vous envoyer les médias. Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?"
  }

  return "Je viens de vous l'envoyer. Vous préférez commencer avec 1 boîte ou faire la cure avec 2 boîtes ?"
}

const sendProductMedia = async (recipient, parameters) => {
  const requestedMediaType = normalizeMediaType(parameters.requestedMediaType)
  const destinationAddress = getDestinationAddress(parameters, recipient)
  const maxItems = getMaxItems(parameters.maxItems)
  const whatsappGroupLinkAlreadySent = isTrueSessionFlag(parameters.whatsappGroupLinkSent || parameters.whatsappGroupLinkAlreadySent)
  const sentProductMediaKeys = getSentProductMediaKeys(parameters.sentProductMedia)
  const sentMedia = []
  const skippedMedia = []
  let whatsappGroupLinkMessageId

  if (!destinationAddress || destinationAddress.toLowerCase?.() === 'non fourni') {
    throw new Error('Destination WhatsApp introuvable')
  }

  if (isTrueSessionFlag(parameters.evaluationMode)) {
    console.info('Evaluation mode enabled; skipping WhatsApp media send.', {
      requestedMediaType,
      destinationAddress
    })
    const evaluationSentMedia = buildEvaluationSentMedia(requestedMediaType)
    const unsentEvaluationMedia = evaluationSentMedia.filter((media) => {
      const mediaKey = getMediaDedupeKey(media.mediaUrl)
      const alreadySent = sentProductMediaKeys.has(mediaKey)
      if (alreadySent) skippedMedia.push({ type: media.type, mediaUrl: media.mediaUrl, reason: 'already_sent' })
      return !alreadySent
    })

    return {
      success: true,
      requestedMediaType,
      sentMedia: unsentEvaluationMedia,
      skippedMedia: [...skippedMedia, { type: requestedMediaType, reason: 'evaluation_mode' }],
      alreadySent: unsentEvaluationMedia.length === 0,
      whatsappGroupLinkSent: whatsappGroupLinkAlreadySent || requestedMediaType === 'presentation',
      whatsappGroupLinkMessageId: null,
      message: 'Evaluation mode: media send skipped.'
    }
  }

  const imageMediaUrls = parseMediaUrls(
    process.env.MIIRACELL_PRODUCT_IMAGE_URLS,
    process.env.MIIRACELL_PRODUCT_IMAGE_URL
  )
  const treatmentImageMediaUrls = parseMediaUrls(
    process.env.MIIRACELL_TREATMENT_IMAGE_URL,
    deriveSiblingMediaUrl(imageMediaUrls, 'miiracell-traitement.jpeg')
  )
  const videoMediaUrls = parseMediaUrls(
    process.env.MIIRACELL_TESTIMONIAL_VIDEO_URLS,
    process.env.MIIRACELL_TESTIMONIAL_VIDEO_URL
  )
  const posologyVideoMediaUrls = parseMediaUrls(
    process.env.MIIRACELL_POSOLOGY_VIDEO_URLS,
    process.env.MIIRACELL_POSOLOGY_VIDEO_URL
  )
  const audioMediaUrls = parseMediaUrls(
    process.env.MIIRACELL_AUDIO_URLS,
    process.env.MIIRACELL_AUDIO_URL,
    PRESENTATION_AUDIO_URLS.join(',')
  )
  const documentMediaUrls = parseMediaUrls(
    process.env.MIIRACELL_PRESENTATION_DOCUMENT_URLS,
    process.env.MIIRACELL_PRESENTATION_DOCUMENT_URL,
    PRESENTATION_DOCUMENT_URL
  )

  console.info('sendProductMedia request', {
    requestedMediaType,
    destinationAddress,
    maxItems,
    imageUrlCount: imageMediaUrls.length,
    treatmentImageUrlCount: treatmentImageMediaUrls.length,
    videoUrlCount: videoMediaUrls.length,
    posologyVideoUrlCount: posologyVideoMediaUrls.length,
    audioUrlCount: audioMediaUrls.length,
    documentUrlCount: documentMediaUrls.length,
    alreadySentMediaCount: sentProductMediaKeys.size
  })

  if (requestedMediaType === 'photo' || requestedMediaType === 'both' || requestedMediaType === 'all') {
    if (!imageMediaUrls.length) throw new Error('MIIRACELL_PRODUCT_IMAGE_URLS is not configured')

    const selectedImageUrls = getUnsentMediaUrls(
      imageMediaUrls.slice(0, requestedMediaType === 'photo' ? maxItems : 1),
      sentProductMediaKeys,
      skippedMedia,
      'photo'
    )

    for (const imageMediaUrl of selectedImageUrls) {
      console.info('Sending Miira-Cell+ image media', { destinationAddress, imageMediaUrl })
      const imageResponse = await WhatsAppService.sendWhatsAppImageLink(
        destinationAddress,
        imageMediaUrl,
        'Voici une photo de Miira-Cell+.'
      )
      console.info('Miira-Cell+ image media response', imageResponse)
      if (!imageResponse?.messageId) throw new Error('WhatsApp image send did not return a messageId')
      sentMedia.push({ type: 'photo', mediaUrl: imageMediaUrl, messageId: imageResponse?.messageId })
      sentProductMediaKeys.add(getMediaDedupeKey(imageMediaUrl))
    }
  }

  if (requestedMediaType === 'treatment_image') {
    if (!treatmentImageMediaUrls.length) throw new Error('MIIRACELL_TREATMENT_IMAGE_URL is not configured')

    const selectedTreatmentImageUrls = getUnsentMediaUrls(treatmentImageMediaUrls.slice(0, 1), sentProductMediaKeys, skippedMedia, 'treatment_image')

    for (const treatmentImageMediaUrl of selectedTreatmentImageUrls) {
      console.info('Sending Miira-Cell+ treatment image media', { destinationAddress, treatmentImageMediaUrl })
      const treatmentImageResponse = await WhatsAppService.sendWhatsAppImageLink(
        destinationAddress,
        treatmentImageMediaUrl,
        'Voici le visuel sur les bienfaits de Miira-Cell+.'
      )
      console.info('Miira-Cell+ treatment image media response', treatmentImageResponse)
      if (!treatmentImageResponse?.messageId) throw new Error('WhatsApp treatment image send did not return a messageId')
      sentMedia.push({ type: 'treatment_image', mediaUrl: treatmentImageMediaUrl, messageId: treatmentImageResponse?.messageId })
      sentProductMediaKeys.add(getMediaDedupeKey(treatmentImageMediaUrl))
    }
  }

  if (requestedMediaType === 'video' || requestedMediaType === 'both' || requestedMediaType === 'all') {
    if (!videoMediaUrls.length) throw new Error('MIIRACELL_TESTIMONIAL_VIDEO_URLS is not configured')

    const remainingSlots = Math.max(maxItems - sentMedia.length, 1)
    const selectedVideoUrls = getUnsentMediaUrls(
      videoMediaUrls.slice(0, requestedMediaType === 'video' ? maxItems : remainingSlots),
      sentProductMediaKeys,
      skippedMedia,
      'video'
    )

    for (const videoMediaUrl of selectedVideoUrls) {
      console.info('Sending Miira-Cell+ video media', { destinationAddress, videoMediaUrl })
      const videoResponse = await WhatsAppService.sendWhatsAppVideoLink(
        destinationAddress,
        videoMediaUrl,
        'Voici une vidéo de témoignage sur Miira-Cell+.'
      )
      console.info('Miira-Cell+ video media response', videoResponse)
      if (!videoResponse?.messageId) throw new Error('WhatsApp video send did not return a messageId')
      sentMedia.push({ type: 'video', mediaUrl: videoMediaUrl, messageId: videoResponse?.messageId })
      sentProductMediaKeys.add(getMediaDedupeKey(videoMediaUrl))
    }
  }

  if (requestedMediaType === 'posology_video') {
    if (!posologyVideoMediaUrls.length) throw new Error('MIIRACELL_POSOLOGY_VIDEO_URLS is not configured')

    const selectedPosologyVideoUrls = getUnsentMediaUrls(posologyVideoMediaUrls.slice(0, maxItems), sentProductMediaKeys, skippedMedia, 'posology_video')

    for (const posologyVideoMediaUrl of selectedPosologyVideoUrls) {
      console.info('Sending Miira-Cell+ posology video media', { destinationAddress, posologyVideoMediaUrl })
      const posologyVideoResponse = await WhatsAppService.sendWhatsAppVideoLink(
        destinationAddress,
        posologyVideoMediaUrl,
        'Voici la vidéo qui explique comment utiliser Miira-Cell+.'
      )
      console.info('Miira-Cell+ posology video media response', posologyVideoResponse)
      if (!posologyVideoResponse?.messageId) throw new Error('WhatsApp posology video send did not return a messageId')
      sentMedia.push({ type: 'posology_video', mediaUrl: posologyVideoMediaUrl, messageId: posologyVideoResponse?.messageId })
      sentProductMediaKeys.add(getMediaDedupeKey(posologyVideoMediaUrl))
    }
  }

  if (requestedMediaType === 'audio' || requestedMediaType === 'presentation' || requestedMediaType === 'all') {
    if (!audioMediaUrls.length) throw new Error('MIIRACELL_AUDIO_URLS is not configured')

    const remainingSlots = Math.max(maxItems - sentMedia.length, 1)
    const selectedAudioUrls = getUnsentMediaUrls(
      audioMediaUrls.slice(0, requestedMediaType === 'audio' || requestedMediaType === 'presentation' ? maxItems : remainingSlots),
      sentProductMediaKeys,
      skippedMedia,
      'audio'
    )

    for (const audioMediaUrl of selectedAudioUrls) {
      console.info('Sending Miira-Cell+ audio media', { destinationAddress, audioMediaUrl })
      const audioResponse = await WhatsAppService.sendWhatsAppAudioLink(
        destinationAddress,
        audioMediaUrl
      )
      console.info('Miira-Cell+ audio media response', audioResponse)
      if (!audioResponse?.messageId) throw new Error('WhatsApp audio send did not return a messageId')
      sentMedia.push({ type: 'audio', mediaUrl: audioMediaUrl, messageId: audioResponse?.messageId })
      sentProductMediaKeys.add(getMediaDedupeKey(audioMediaUrl))
    }
  }

  if (requestedMediaType === 'document' || requestedMediaType === 'presentation' || requestedMediaType === 'all') {
    if (!documentMediaUrls.length) throw new Error('MIIRACELL_PRESENTATION_DOCUMENT_URLS is not configured')

    const remainingSlots = Math.max(maxItems - sentMedia.length, 1)
    const selectedDocumentUrls = getUnsentMediaUrls(
      documentMediaUrls.slice(0, requestedMediaType === 'document' ? maxItems : remainingSlots),
      sentProductMediaKeys,
      skippedMedia,
      'document'
    )

    for (const documentMediaUrl of selectedDocumentUrls) {
      const filename = documentMediaUrl.split('/').pop() || 'presentation-miiracell.pdf'
      console.info('Sending Miira-Cell+ document media', { destinationAddress, documentMediaUrl, filename })
      const documentResponse = await WhatsAppService.sendWhatsAppDocumentLink(
        destinationAddress,
        documentMediaUrl,
        'Voici le document de présentation de Miira-Cell+.',
        filename
      )
      console.info('Miira-Cell+ document media response', documentResponse)
      if (!documentResponse?.messageId) throw new Error('WhatsApp document send did not return a messageId')
      sentMedia.push({ type: 'document', mediaUrl: documentMediaUrl, messageId: documentResponse?.messageId })
      sentProductMediaKeys.add(getMediaDedupeKey(documentMediaUrl))
    }
  }

  if (requestedMediaType === 'presentation' && !whatsappGroupLinkAlreadySent) {
    whatsappGroupLinkMessageId = await sendWhatsAppGroupLinkAfterPresentation(destinationAddress)
  }

  return {
    success: true,
    requestedMediaType,
    sentMedia,
    skippedMedia,
    alreadySent: sentMedia.length === 0 && skippedMedia.length > 0 && !whatsappGroupLinkMessageId,
    whatsappGroupLinkSent: whatsappGroupLinkAlreadySent || Boolean(whatsappGroupLinkMessageId),
    whatsappGroupLinkMessageId,
    message: sentMedia.length ? 'Média envoyé au prospect via WhatsApp.' : 'Média déjà envoyé au prospect via WhatsApp.'
  }
}

const buildMediaLimitReachedResult = (functionInvocationInput = {}) => ({
  functionResult: {
    actionGroup: functionInvocationInput?.actionGroup,
    function: functionInvocationInput?.function,
    responseBody: {
      TEXT: {
        body: JSON.stringify({
          success: true,
          mediaLimitReached: true,
          sentMedia: [],
          skippedMedia: [],
          message: "Limite de medias atteinte pour ce tour: n'envoie plus aucun media maintenant et reponds au prospect par un message texte."
        })
      }
    }
  }
})

const executeReturnControl = async (returnControl, recipient, sessionVariables = {}) => {
  const functionInvocationInput = getFunctionInvocationInput(returnControl)
  const actionGroup = functionInvocationInput?.actionGroup
  const functionName = functionInvocationInput?.function
  const parameters = getFunctionParameters(functionInvocationInput)

  let responsePayload

  try {
    if (actionGroup === SEND_PRODUCT_MEDIA_ACTION_GROUP && functionName === SEND_PRODUCT_MEDIA_FUNCTION) {
      responsePayload = await sendProductMedia(recipient, {
        ...parameters,
        evaluationMode: sessionVariables.evaluationMode,
        whatsappGroupLinkSent: sessionVariables.whatsappGroupLinkSent,
        sentProductMedia: sessionVariables.sentProductMedia
      })
      if (responsePayload?.success && responsePayload.sentMedia?.length) {
        sessionVariables.sentProductMedia = serializeSentProductMedia(mergeSentProductMedia(sessionVariables.sentProductMedia, responsePayload.sentMedia))
      }
    } else {
      responsePayload = {
        success: false,
        message: `Action non prise en charge: ${actionGroup}.${functionName}`
      }
    }
  } catch (error) {
    console.error('executeReturnControl error: ', error)
    responsePayload = {
      success: false,
      message: error.message
    }
  }

  console.info('Return control result payload', {
    actionGroup,
    functionName,
    responsePayload
  })

  return {
    functionResult: {
      actionGroup,
      function: functionName,
      responseBody: {
        TEXT: {
          body: JSON.stringify(responsePayload)
        }
      }
    }
  }
}

exports.handler = async (event, context, callback) => {
  try {
    console.info("App Version:", process.env.APPLICATION_VERSION)
    console.trace(`Event: `, JSON.stringify(event,null,2));

    let recipient = event.recipient
    let useCase = event.useCase
    const previousSessionVariables = event.sessionVariables || {}
    let sessionId = previousSessionVariables.sessionId
    const conversationState = parseSessionJson(previousSessionVariables.strandsConversationState, {})
    const responsePolicy = parseSessionJson(previousSessionVariables.strandsResponsePolicy, {})
    const currentObjections = detectObjections(recipient.messageBody)
    const handledObjections = normalizeHandledObjections(previousSessionVariables.handledObjections)
    const priceObjectionResponseAlreadySent = previousSessionVariables.priceObjectionResponseSent === 'true' ||
      hasPriceObjectionResponseInConversation(event.conversation)
    const productPresentationPackChoiceResponseAlreadySent = previousSessionVariables.productPresentationPackChoiceResponseSent === 'true' ||
      hasProductPresentationPackChoiceResponseInConversation(event.conversation)
    const knownProspectInfo = deriveKnownProspectInfo(previousSessionVariables, event.conversation, recipient.messageBody)
    const medicalSafetyContext = isMedicalSafetyContext(conversationState, responsePolicy)
    const salesPushRestricted = medicalSafetyContext || responsePolicyAvoidsSalesPush(responsePolicy)
    const responseSessionVariables = {
      ...previousSessionVariables,
      ...knownProspectInfo,
      sessionId,
      handledObjections,
      priceObjectionResponseSent: priceObjectionResponseAlreadySent ? 'true' : 'false',
      productPresentationPackChoiceResponseSent: productPresentationPackChoiceResponseAlreadySent ? 'true' : 'false',
      sentProductMedia: serializeSentProductMedia(previousSessionVariables.sentProductMedia)
    }

    const userSessionAttributes = {
      "name": recipient.senderName,
      "phoneNumber": recipient.destinationAddress,
      "whatsappNumber": recipient.destinationAddress,
      "handledObjections": JSON.stringify(handledObjections),
      "priceObjectionResponseSent": responseSessionVariables.priceObjectionResponseSent,
      "productPresentationPackChoiceResponseSent": responseSessionVariables.productPresentationPackChoiceResponseSent,
      "whatsappGroupLinkSent": responseSessionVariables.whatsappGroupLinkSent || 'false',
      "sentProductMedia": responseSessionVariables.sentProductMedia,
      "strandsConversationState": previousSessionVariables.strandsConversationState || '',
      "strandsResponsePolicy": previousSessionVariables.strandsResponsePolicy || '',
      ...getProspectSessionAttributes(responseSessionVariables)
    }

    const sessionState = {
      "sessionAttributes": userSessionAttributes,
      "promptSessionAttributes": userSessionAttributes
    }

    //If the first message is outbound, send message with instructions to the agent but do not send the response
    if(event.conversation.length === 1 && event.conversation[0].direction === 'outbound'){
      let initialMessage = process.env.AGENT_PRELOAD_MESSAGE + event.conversation[0].message
      let agentResponse = await BedrockService.invokeAgent(initialMessage, useCase, sessionId, sessionState)
      console.trace('preloadAgentResponse: ', agentResponse.completion)
    }

    if (wantsToReviewSentMessages(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': SENT_MESSAGES_REVIEW_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, SENT_MESSAGES_REVIEW_RESPONSE)})
      return
    }

    if (hasAntiHardSellQuestioning(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': ANTI_HARD_SELL_QUESTIONS_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, ANTI_HARD_SELL_QUESTIONS_RESPONSE)})
      return
    }

    if (hasInappropriateAdultContent(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': INAPPROPRIATE_CONTENT_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, INAPPROPRIATE_CONTENT_RESPONSE)})
      return
    }

    if (hasExternalPromotionMessage(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': EXTERNAL_PROMOTION_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, EXTERNAL_PROMOTION_RESPONSE)})
      return
    }

    if (conversationState.currentIntent === 'unknown' && salesPushRestricted && responsePolicy.nextBestAction === 'answer_latest_message_directly_and_avoid_repetition') {
      callback(null, {'llmSessionId': sessionId, 'response': UNCLEAR_MESSAGE_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, UNCLEAR_MESSAGE_RESPONSE)})
      return
    }

    if (hasLowInformationOrUnclearMessage(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': UNCLEAR_MESSAGE_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, UNCLEAR_MESSAGE_RESPONSE)})
      return
    }

    // Apres confirmation de commande, le tunnel se deroule en trois etapes:
    //  1) tant que le mode de paiement n'est pas choisi -> proposer le choix
    //     (rendu en boutons PAY_COD / PAY_MOMO par la couche WhatsApp interactive);
    //  2) une fois le mode de paiement choisi -> collecter le lieu de livraison ET les
    //     coordonnees (nom, prenom, e-mail, telephone) manquants AVANT le recapitulatif;
    //  3) quand tout est connu -> recapitulatif, puis finalisation a la confirmation du recap.
    const orderConfirmedContext = conversationState.currentPurchaseStage === 'order_confirmation' ||
      isTrueSessionFlag(responseSessionVariables.prospectConfirmedOrder) ||
      responsePolicy.nextBestAction === 'confirm_order_and_collect_missing_payment_or_delivery_detail'
    const paymentModeKnown = Boolean(knownProspectInfo.knownPaymentMode || conversationState.knownProspectInfo?.paymentMode)
    const deliveryLocationKnown = Boolean(knownProspectInfo.knownDeliveryLocation || conversationState.knownProspectInfo?.deliveryLocation)
    if (orderConfirmedContext && !medicalSafetyContext) {
      // 1) Pas encore de mode de paiement: proposer le choix du paiement.
      if (!paymentModeKnown) {
        const response = buildOrderConfirmationResponse(knownProspectInfo, conversationState)
        callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
        return
      }
      // 3) Lieu de livraison ET coordonnees connus: recapitulatif (ou finalisation si le prospect confirme le recap).
      if (deliveryLocationKnown && hasCompleteContactDetails(knownProspectInfo)) {
        // Le prospect a tape "Confirmer" sur le recapitulatif: on finalise (paiement)
        // au lieu de reafficher le meme recapitulatif en boucle.
        if (hasOrderRecapConfirmationSignal(recipient.messageBody)) {
          const response = buildOrderConfirmationResponse(knownProspectInfo, conversationState)
          callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
          return
        }
        const response = buildOrderRecapResponse(knownProspectInfo, conversationState)
        callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
        return
      }
      // 2) Mode de paiement choisi: demander le lieu de livraison + les coordonnees manquants.
      const response = buildContactAndDeliveryRequest(knownProspectInfo, conversationState)
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'business_interest')) {
      const response = buildBusinessInterestResponse(recipient.messageBody, responseSessionVariables, event.conversation)
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'closing')) {
      const response = buildNeutralFollowUpResponse(event.conversation)
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'follow_up') &&
      !responsePolicyHasDirectAnswerPriority(responsePolicy) &&
      !/\b(?:commande|livraison|livrer|promis|17\s*h|j['’ ]?attends)\b/i.test(recipient.messageBody || '')) {
      const response = buildNeutralFollowUpResponse(event.conversation)
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'proof')) {
      if (conversationState.currentIntent === 'media_or_proof_request' ||
        responsePolicy.nextBestAction === 'send_requested_media_or_proof_without_repeating_full_pitch') {
        const mediaPayload = await sendProductMedia(recipient, {
          requestedMediaType: 'video',
          evaluationMode: responseSessionVariables.evaluationMode,
          whatsappNumber: recipient.destinationAddress,
          userMessage: recipient.messageBody,
          whatsappGroupLinkSent: responseSessionVariables.whatsappGroupLinkSent,
          sentProductMedia: responseSessionVariables.sentProductMedia
        }).catch((error) => {
          console.error('Proof response media send error: ', error)
          return {
            success: false,
            requestedMediaType: 'video',
            message: error.message
          }
        })
        if (mediaPayload?.success && mediaPayload.sentMedia?.length) {
          responseSessionVariables.sentProductMedia = serializeSentProductMedia(mergeSentProductMedia(responseSessionVariables.sentProductMedia, mediaPayload.sentMedia))
        }
        const response = mediaPayload?.alreadySent
          ? "Je vous ai deja envoye les supports disponibles. Prenez le temps de les consulter, je reste disponible pour une precision sur Miira-Cell+."
          : "Je viens de vous envoyer les supports disponibles. Prenez le temps de les consulter, je reste disponible pour une precision sur Miira-Cell+."
        callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
        return
      }
      const response = hasCertificationOrSafetyProofQuestion(recipient.messageBody)
        ? buildProofSafetyResponse(event.conversation)
        : hasVideoRequest(recipient.messageBody)
          ? PRODUCT_VIDEO_RESPONSE
          : MEDICAL_TESTIMONIAL_SAFETY_RESPONSE
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'price') && hasOneBoxPriceQuestion(recipient.messageBody) && !medicalSafetyContext) {
      callback(null, {'llmSessionId': sessionId, 'response': ONE_BOX_PRICE_AND_CONTENT_DIRECT_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, ONE_BOX_PRICE_AND_CONTENT_DIRECT_RESPONSE)})
      return
    }

    if (medicalSafetyContext) {
      const response = buildMedicalSafetyResponse()
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'information') &&
      responsePolicyMustAnswer(responsePolicy, 'delivery') &&
      hasDirectDeliveryQuestion(recipient.messageBody)) {
      const response = hasCoteDIvoireContext(recipient.messageBody, knownProspectInfo, conversationState)
        ? COTE_DIVOIRE_AVAILABILITY_RESPONSE
        : buildLocalDeliveryDetailsResponse(recipient.messageBody, knownProspectInfo, conversationState)
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'information') && responsePolicyMustAnswer(responsePolicy, 'delivery')) {
      const response = suppressRepeatedProductPresentationPackChoiceResponse(PRODUCT_INFO_AND_BUSINESS_LOCATION_RESPONSE, isTrueSessionFlag(responseSessionVariables.productPresentationPackChoiceResponseSent))
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'information') &&
      responsePolicyMustNotRepeat(responsePolicy, 'product_presentation_pack_choice')) {
      const response = "Je vous ai deja envoye les audios et le document de presentation. Je reste disponible si vous souhaitez une precision sur Miira-Cell+."
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (hasOneBoxPriceQuestion(recipient.messageBody) && hasBoxContentQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': ONE_BOX_PRICE_AND_CONTENT_DIRECT_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, ONE_BOX_PRICE_AND_CONTENT_DIRECT_RESPONSE)})
      return
    }

    if (hasIngredientCompositionQuestion(recipient.messageBody)) {
      let response = normalizeProductRulesInResponse(normalizeIngredientNamesInResponse(await answerIngredientCompositionFromKnowledgeBase(recipient.messageBody, useCase, sessionId)))
      if (responsePolicyMustAnswer(responsePolicy, 'usage') && !normalizeResponseForComparison(response).includes('1 sachet')) {
        response = `${response} ${PRODUCT_POSOLOGY_RESPONSE}`
      }
      const requestedMediaType = detectRequestedMediaType(recipient.messageBody)

      if (requestedMediaType) {
        console.info('Ingredient response media detection triggered', {
          requestedMediaType,
          messageBody: recipient.messageBody
        })
        const mediaPayload = await sendProductMedia(recipient, {
          requestedMediaType,
          evaluationMode: responseSessionVariables.evaluationMode,
          whatsappNumber: recipient.destinationAddress,
          userMessage: recipient.messageBody,
          whatsappGroupLinkSent: responseSessionVariables.whatsappGroupLinkSent,
          sentProductMedia: responseSessionVariables.sentProductMedia
        }).catch((error) => {
          console.error('Ingredient response media send error: ', error)
          return {
            success: false,
            requestedMediaType,
            message: error.message
          }
        })
        if (mediaPayload?.success && mediaPayload.sentMedia?.length) {
          responseSessionVariables.sentProductMedia = serializeSentProductMedia(mergeSentProductMedia(responseSessionVariables.sentProductMedia, mediaPayload.sentMedia))
        }
        response = normalizeProductRulesInResponse(normalizeIngredientNamesInResponse(mergeMediaFallbackWithAgentResponse(
          buildMediaFallbackResponse(mediaPayload, event.conversation, responseSessionVariables.whatsappGroupLinkSent === 'true' || Boolean(mediaPayload?.whatsappGroupLinkSent)),
          response
        )))
        if (mediaPayload?.requestedMediaType === 'presentation' && mediaPayload?.success && (mediaPayload?.whatsappGroupLinkSent || response.includes(WHATSAPP_GROUP_LINK))) {
          responseSessionVariables.whatsappGroupLinkSent = 'true'
        }
      }

      response = suppressRepeatedProductPresentationPackChoiceResponse(response, isTrueSessionFlag(responseSessionVariables.productPresentationPackChoiceResponseSent))
      if (salesPushRestricted) {
        response = response
          .replace(/\s*Vous préférez commencer avec 1 boîte[^?.!]*[?.!]/gi, ' ')
          .replace(/\s*Vous préférez commencer avec combien de boîtes\s*\??/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Bedrock Knowledge Base', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'usage') && hasBoxContentQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': BOX_CONTENT_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, BOX_CONTENT_RESPONSE)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'usage') && responsePolicyMustAnswer(responsePolicy, 'price') && hasPriceOrBudgetUsageQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': PRODUCT_POSOLOGY_BUDGET_SAFETY_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, PRODUCT_POSOLOGY_BUDGET_SAFETY_RESPONSE)})
      return
    }

    if (hasTreatmentQuantityQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': TREATMENT_BOX_COUNT_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, TREATMENT_BOX_COUNT_RESPONSE)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'usage') && conversationState.knownProspectInfo?.medicalConcern) {
      const response = buildMedicalSafetyResponse()
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'usage')) {
      callback(null, {'llmSessionId': sessionId, 'response': PRODUCT_POSOLOGY_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, PRODUCT_POSOLOGY_RESPONSE)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'delivery') && hasAiSuspicion(recipient.messageBody) && hasGabonContext(recipient.messageBody, knownProspectInfo, conversationState)) {
      callback(null, {'llmSessionId': sessionId, 'response': AI_SUSPICION_GABON_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, AI_SUSPICION_GABON_RESPONSE)})
      return
    }

    if (hasAiSuspicion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': AI_SUSPICION_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, AI_SUSPICION_RESPONSE)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'payment')) {
      const response = buildPaymentDetailsResponse(recipient.messageBody, knownProspectInfo, conversationState)
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (isGabonPhoneNumber(recipient.destinationAddress) && hasBusinessLocationQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': GABON_NUMBER_LOCATION_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, GABON_NUMBER_LOCATION_RESPONSE)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'delivery') && /port[-\s]?gentil/i.test(`${recipient.messageBody} ${knownProspectInfo.knownDeliveryLocation || ''} ${conversationState.knownProspectInfo?.deliveryLocation || ''}`)) {
      callback(null, {'llmSessionId': sessionId, 'response': PORT_GENTIL_PAYMENT_DELIVERY_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, PORT_GENTIL_PAYMENT_DELIVERY_RESPONSE)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'delivery') && hasGabonContext(recipient.messageBody, knownProspectInfo, conversationState)) {
      const response = buildGabonDeliveryResponse(event.conversation)
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'delivery') && hasCoteDIvoireContext(recipient.messageBody, knownProspectInfo, conversationState)) {
      callback(null, {'llmSessionId': sessionId, 'response': COTE_DIVOIRE_AVAILABILITY_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, COTE_DIVOIRE_AVAILABILITY_RESPONSE)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'delivery') && hasBusinessLocationQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': BUSINESS_LOCATION_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, BUSINESS_LOCATION_RESPONSE)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'follow_up') && /\b(?:commande|livraison|livrer|promis|17\s*h|j['’ ]?attends)\b/i.test(recipient.messageBody || '')) {
      const response = buildDeliveryFollowUpResponse(recipient.messageBody, knownProspectInfo, conversationState)
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'delivery') && (extractKnownDeliveryLabel(recipient.messageBody, knownProspectInfo, conversationState) || knownProspectInfo.knownBoxQuantity || conversationState.knownProspectInfo?.quantity)) {
      const response = buildLocalDeliveryDetailsResponse(recipient.messageBody, knownProspectInfo, conversationState)
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'purchase') &&
      responsePolicy.nextBestAction === 'confirm_order_and_collect_missing_payment_or_delivery_detail') {
      let response = buildOrderConfirmationResponse(knownProspectInfo, conversationState)
      if (salesPushRestricted) {
        response = `${response} ${MEDICAL_SUPPLEMENT_REMINDER}`
      }
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'purchase') && salesPushRestricted) {
      callback(null, {'llmSessionId': sessionId, 'response': MEDICAL_CONTEXT_ORDER_INFO_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, MEDICAL_CONTEXT_ORDER_INFO_RESPONSE)})
      return
    }

    if (responsePolicyMustAnswer(responsePolicy, 'purchase') &&
      responsePolicy.nextBestAction === 'confirm_pack_or_quantity_without_repeating_full_pitch' &&
      responsePolicyMustNotRepeat(responsePolicy, 'ask_quantity')) {
      const response = buildQuantitySelectedResponse(knownProspectInfo, conversationState)
      if (response) {
        callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
        return
      }
    }

    if (responsePolicyMustAnswer(responsePolicy, 'purchase') && hasOneBoxBronzeCorrectionSignal(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': ONE_BOX_BRONZE_CORRECTION_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, ONE_BOX_BRONZE_CORRECTION_RESPONSE)})
      return
    }

    if (hasDirectOrderIntentWithoutQuantity(recipient.messageBody)) {
      if (salesPushRestricted) {
        callback(null, {'llmSessionId': sessionId, 'response': MEDICAL_CONTEXT_ORDER_INFO_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, MEDICAL_CONTEXT_ORDER_INFO_RESPONSE)})
        return
      }
      const response = suppressRepeatedProductPresentationPackChoiceResponse(DIRECT_ORDER_WITHOUT_QUANTITY_RESPONSE, isTrueSessionFlag(responseSessionVariables.productPresentationPackChoiceResponseSent))
      callback(null, {'llmSessionId': sessionId, 'response': response, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)})
      return
    }

    if (hasGabonRepresentationQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': GABON_REPRESENTATION_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, GABON_REPRESENTATION_RESPONSE)})
      return
    }

    if (hasProductAvailabilityQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': PRODUCT_AVAILABILITY_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, PRODUCT_AVAILABILITY_RESPONSE)})
      return
    }

    if (isPriceHighObjectionTurn(currentObjections) &&
      !responsePolicyMustAnswer(responsePolicy, 'follow_up') &&
      !responsePolicyMustNotRepeat(responsePolicy, 'price_objection_argument')) {
      callback(null, {'llmSessionId': sessionId, 'response': PRICE_HIGH_SHORT_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, PRICE_HIGH_SHORT_RESPONSE)})
      return
    }

    if (responsePolicy.nextBestAction === 'answer_price_directly_then_one_soft_next_question' && !isPriceHighObjectionTurn(currentObjections) && !hasOneBoxPriceQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': PRICE_PACKS_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, PRICE_PACKS_RESPONSE)})
      return
    }

    if (hasOneBoxPriceQuestion(recipient.messageBody)) {
      callback(null, {'llmSessionId': sessionId, 'response': ONE_BOX_PRICE_AND_CONTENT_RESPONSE, 'source': 'Deterministic Rule', 'sessionVariables': finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, ONE_BOX_PRICE_AND_CONTENT_RESPONSE)})
      return
    }

    let agentResponse = await BedrockService.invokeAgent(
      buildCompleteProspectResponsePrompt(
        recipient.messageBody,
        handledObjections,
        knownProspectInfo,
        responseSessionVariables.priceObjectionResponseSent,
        responseSessionVariables.productPresentationPackChoiceResponseSent,
        conversationState,
        responsePolicy
      ),
      useCase,
      sessionId,
      sessionState
    )
    console.trace('agentResponse: ', agentResponse)

    let returnControlCount = 0
    let productMediaSendCount = 0
    let presentationMediaHandled = false
    while (agentResponse.returnControl && returnControlCount < MAX_RETURN_CONTROL_ITERATIONS) {
      const pendingInvocationInput = getFunctionInvocationInput(agentResponse.returnControl)
      const isProductMediaCall = pendingInvocationInput?.actionGroup === SEND_PRODUCT_MEDIA_ACTION_GROUP &&
        pendingInvocationInput?.function === SEND_PRODUCT_MEDIA_FUNCTION
      const mediaLimitReached = isProductMediaCall && productMediaSendCount >= MAX_PRODUCT_MEDIA_SENDS_PER_TURN

      let returnControlResult
      if (mediaLimitReached) {
        console.info('Product media send limit reached for this turn; skipping additional media', {
          productMediaSendCount,
          maxProductMediaSendsPerTurn: MAX_PRODUCT_MEDIA_SENDS_PER_TURN,
          requestedMediaType: getFunctionParameters(pendingInvocationInput)?.requestedMediaType
        })
        returnControlResult = buildMediaLimitReachedResult(pendingInvocationInput)
      } else {
        returnControlResult = await executeReturnControl(agentResponse.returnControl, recipient, responseSessionVariables)
        if (isProductMediaCall) productMediaSendCount++
      }

      const returnControlResponsePayload = getReturnControlResponsePayload(returnControlResult)
      if (isProductMediaReturnControlResult(returnControlResult) && returnControlResponsePayload?.requestedMediaType === 'presentation' && returnControlResponsePayload?.success) {
        presentationMediaHandled = true
        if (returnControlResponsePayload?.whatsappGroupLinkSent) {
          responseSessionVariables.whatsappGroupLinkSent = 'true'
        }
      }
      const returnControlSessionState = {
        invocationId: agentResponse.returnControl.invocationId,
        returnControlInvocationResults: [returnControlResult]
      }

      const postReturnControlPrompt = isProductMediaReturnControlResult(returnControlResult)
        ? buildPostMediaResponsePrompt(
          recipient.messageBody,
          returnControlResult,
          handledObjections,
          knownProspectInfo,
          responseSessionVariables.priceObjectionResponseSent,
          responseSessionVariables.productPresentationPackChoiceResponseSent,
          conversationState,
          responsePolicy
        )
        : ''

      agentResponse = await BedrockService.invokeAgent(postReturnControlPrompt, useCase, sessionId, returnControlSessionState)
      console.trace('agentResponseAfterReturnControl: ', agentResponse)
      returnControlCount++
    }

    // Garde-fou: si l'agent reclame encore un outil mais n'a produit aucun texte,
    // on cloture proprement (resultat "limite atteinte") et on force une derniere reponse texte
    // afin de ne jamais renvoyer une reponse vide au prospect.
    if (agentResponse.returnControl && !String(agentResponse.completion || '').trim()) {
      const pendingInvocationInput = getFunctionInvocationInput(agentResponse.returnControl)
      const finalReturnControlResult = buildMediaLimitReachedResult(pendingInvocationInput)
      console.info('Return control still pending without completion; forcing final text response', {
        returnControlCount,
        productMediaSendCount
      })
      agentResponse = await BedrockService.invokeAgent(
        buildPostMediaResponsePrompt(
          recipient.messageBody,
          finalReturnControlResult,
          handledObjections,
          knownProspectInfo,
          responseSessionVariables.priceObjectionResponseSent,
          responseSessionVariables.productPresentationPackChoiceResponseSent,
          conversationState,
          responsePolicy
        ),
        useCase,
        sessionId,
        {
          invocationId: agentResponse.returnControl.invocationId,
          returnControlInvocationResults: [finalReturnControlResult]
        }
      )
      console.trace('agentResponseAfterFinalReturnControl: ', agentResponse)
    }

    let response = normalizeProductRulesInResponse(agentResponse.completion)
    const explicitMedicalMention = hasExplicitMedicalMention(recipient.messageBody)
    if (explicitMedicalMention || medicalSafetyContext) {
      response = buildMedicalSafetyResponse()
    }
    const membershipQuestion = hasMembershipQuestion(recipient.messageBody)
    if (membershipQuestion) {
      response = MEMBERSHIP_RESPONSE
    }
    const whatsappGroupLinkAlreadySent = responseSessionVariables.whatsappGroupLinkSent === 'true'
    const fallbackRequestedMediaType = !returnControlCount && !explicitMedicalMention && !salesPushRestricted && !membershipQuestion ? detectRequestedMediaType(recipient.messageBody) : null
    if (fallbackRequestedMediaType) {
      console.info('Fallback media detection triggered', {
        requestedMediaType: fallbackRequestedMediaType,
        messageBody: recipient.messageBody
      })
      const fallbackPayload = await sendProductMedia(recipient, {
        requestedMediaType: fallbackRequestedMediaType,
        evaluationMode: responseSessionVariables.evaluationMode,
        whatsappNumber: recipient.destinationAddress,
        userMessage: recipient.messageBody,
        whatsappGroupLinkSent: responseSessionVariables.whatsappGroupLinkSent,
        sentProductMedia: responseSessionVariables.sentProductMedia
      }).catch((error) => {
        console.error('Fallback media send error: ', error)
        return {
          success: false,
          requestedMediaType: fallbackRequestedMediaType,
          message: error.message
        }
      })
      if (fallbackPayload?.success && fallbackPayload.sentMedia?.length) {
        responseSessionVariables.sentProductMedia = serializeSentProductMedia(mergeSentProductMedia(responseSessionVariables.sentProductMedia, fallbackPayload.sentMedia))
      }
      response = normalizeProductRulesInResponse(mergeMediaFallbackWithAgentResponse(
        buildMediaFallbackResponse(fallbackPayload, event.conversation, whatsappGroupLinkAlreadySent || Boolean(fallbackPayload?.whatsappGroupLinkSent)),
        response
      ))
      if (fallbackPayload?.requestedMediaType === 'presentation' && fallbackPayload?.success) {
        presentationMediaHandled = true
        if (fallbackPayload?.whatsappGroupLinkSent) {
          responseSessionVariables.whatsappGroupLinkSent = 'true'
        }
      }
    }
    if (!String(response || '').trim()) {
      console.info('Empty agent completion after return control; using deterministic fallback text', {
        returnControlCount,
        productMediaSendCount
      })
      response = normalizeProductRulesInResponse(
        productMediaSendCount > 0
          ? buildMediaFallbackResponse(
            { success: true, sentMedia: new Array(productMediaSendCount).fill({ type: 'media' }) },
            event.conversation,
            responseSessionVariables.whatsappGroupLinkSent === 'true'
          )
          : NEUTRAL_FOLLOW_UP_RESPONSE
      )
    }
    if (presentationMediaHandled) {
      response = ensureWhatsAppGroupLinkDuringPresentation(response, responseSessionVariables.whatsappGroupLinkSent === 'true')
    }
    response = ensureOnlinePaymentLinkInResponse(response, recipient.messageBody, knownProspectInfo)
    response = normalizePriceObjectionResponse(response, currentObjections)
    response = suppressRepeatedPriceObjectionResponse(
      response,
      hasPriceObjectionAlreadyBeenHandled(handledObjections, responseSessionVariables.priceObjectionResponseSent) ||
        responsePolicyMustNotRepeat(responsePolicy, 'price_objection_argument')
    )
    response = suppressRepeatedProductPresentationPackChoiceResponse(response, isTrueSessionFlag(responseSessionVariables.productPresentationPackChoiceResponseSent))
    if (medicalSafetyContext) {
      response = buildMedicalSafetyResponse()
    }
    const orderConfirmationTurn = isOrderConfirmationTurn(recipient.messageBody, event.conversation, response)
    const conversationClosingTurn = hasConversationClosingPhrase(response)
    if (orderConfirmationTurn) {
      responseSessionVariables.orderConfirmed = 'true'
      responseSessionVariables.orderConfirmedAt = new Date().toISOString()
    }
    if (response.includes(WHATSAPP_GROUP_LINK)) {
      responseSessionVariables.whatsappGroupLinkSent = 'true'
    }
    if (conversationClosingTurn) {
      responseSessionVariables.conversationClosed = 'true'
      responseSessionVariables.conversationClosedAt = new Date().toISOString()
      responseSessionVariables.conversationClosedReason = 'agent_closing_phrase'
    }
    let source = 'Bedrock Agent'
    const finalSessionVariables = finalizeSessionVariablesAfterResponse(responseSessionVariables, currentObjections, response)

    callback(null, {'llmSessionId': sessionId, 'response': response, 'source': source, 'sessionVariables': finalSessionVariables})
  }
  catch (error) {
    console.error(error);
    callback(error)
  }
}
