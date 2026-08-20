import { createHmac } from "node:crypto";
import { config } from "../config";
import { prisma } from "../db";

/**
 * Routeur de cohabitation multi-agents sur un même numéro WhatsApp.
 *
 * Meta n'autorise qu'UN seul webhook par numéro. Ce module transforme
 * l'agent marketing en répartiteur central :
 *   - messages à intention marketing (lead connu, clic publicitaire,
 *     mots-clés d'achat/réservation) → traités par l'agent marketing ;
 *   - tout le reste → transféré à l'agent réceptionniste
 *     (RECEPTIONIST_WEBHOOK_URL), qui conserve ainsi son rôle par défaut.
 *
 * Fiabilité :
 *   - re-signature HMAC-SHA256 du payload (FB_APP_SECRET) pour rester
 *     compatible avec un réceptionniste qui valide les signatures Meta ;
 *   - timeout de 5 s : un réceptionniste en panne ne bloque jamais le
 *     webhook (Meta reçoit toujours un 200) ;
 *   - filet de sécurité : si le transfert échoue, le message est traité
 *     localement pour ne jamais être perdu.
 */

/** Mots-clés normalisés (sans accents) indiquant une intention d'achat. */
const MARKETING_INTENT = [
  "reserver",
  "reservation",
  "resa",
  "booking",
  "book",
  "prix",
  "tarif",
  "cout",
  "combien",
  "price",
  "rate",
  "devis",
  "quote",
  "offre",
  "promo",
  "promotion",
  "reduction",
  "discount",
  "disponib",
  "dispo",
  "availab",
  "sejour",
  "stay",
  "weekend",
  "week-end",
  "vacances",
  "nuit",
  "nights",
  "hotel",
  "conrad",
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Vrai si le transfert vers l'agent réceptionniste est configuré. */
export function routerEnabled(): boolean {
  return Boolean(config.router.receptionistWebhookUrl);
}

export type RoutingVerdict = "marketing" | "reception";

/**
 * Décide qui traite un message entrant.
 * Priorité : lead connu > clic publicitaire > intention d'achat > réceptionniste.
 */
export async function classifyMessage(input: {
  channel: "whatsapp" | "messenger";
  senderId: string;
  text: string;
  hasAdContext: boolean;
}): Promise<RoutingVerdict> {
  if (!routerEnabled()) return "marketing";

  // 1. Déjà un lead connu chez l'agent marketing → la conversation lui appartient
  const existing = await prisma.lead.findFirst({
    where:
      input.channel === "whatsapp"
        ? { phone: input.senderId }
        : { messengerPsid: input.senderId },
    select: { id: true },
  });
  if (existing) return "marketing";

  // 2. Message arrivé via une publicité (Click-to-WhatsApp Ads)
  if (input.hasAdContext) return "marketing";

  // 3. Intention d'achat / réservation détectée dans le texte
  const t = norm(input.text);
  for (const kw of MARKETING_INTENT) {
    if (t.includes(kw)) return "marketing";
  }

  // 4. Par défaut → réceptionniste (préserve son comportement actuel)
  return "reception";
}

/**
 * Transfère un payload Meta (entier ou filtré) vers l'agent réceptionniste.
 * Renvoie `true` si le réceptionniste a accusé réception.
 */
export async function forwardToReceptionist(payload: unknown): Promise<boolean> {
  const url = config.router.receptionistWebhookUrl;
  if (!url) return false;

  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-by": "hotel-marketing-agent",
  };
  if (config.facebook.appSecret) {
    headers["x-hub-signature-256"] =
      "sha256=" + createHmac("sha256", config.facebook.appSecret).update(raw).digest("hex");
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: raw,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[router] Réceptionniste a répondu ${res.status} : ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[router] Transfert vers le réceptionniste impossible :", err);
    return false;
  }
}
