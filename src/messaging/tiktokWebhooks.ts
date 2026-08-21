import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { captureLead } from "../inbound/leadCapture";

/**
 * Webhooks TikTok (Marketing API) :
 *  - vérification de la signature HMAC-SHA256 (X-TikTok-Signature)
 *    calculée avec le client secret de l'app ;
 *  - réponse au « ping » de validation envoyé par TikTok à la configuration ;
 *  - capture des leads TikTok Ads (Lead Generation) directement dans le CRM.
 */

/** Vérifie la signature HMAC-SHA256 d'un payload TikTok (corps brut). */
export function verifyTiktokSignature(raw: string | Buffer, signature?: string): boolean {
  if (!config.tiktok.clientSecret) return true; // secret non configuré → pas de vérification
  if (!signature) return false;
  const expected = createHmac("sha256", config.tiktok.clientSecret)
    .update(raw)
    .digest("hex");
  const sig = signature.replace(/^sha256=/i, "");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cherche récursivement des objets « lead » dans un payload TikTok (formats variables). */
function findLeadObjects(node: unknown, out: any[] = [], depth = 0): any[] {
  if (!node || depth > 5 || Array.isArray(node)) {
    if (Array.isArray(node)) for (const item of node) findLeadObjects(item, out, depth);
    return out;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const phone = obj.phone_number ?? obj.phone ?? obj.phoneNumber;
    const email = obj.email;
    if ((phone || email) && (obj.name || obj.full_name || obj.lead_id || obj.ad_id)) {
      out.push(obj);
    }
    for (const v of Object.values(obj)) findLeadObjects(v, out, depth + 1);
  }
  return out;
}

export interface TikTokEventResult {
  ping: boolean;
  leads: number;
}

/**
 * Traite un événement TikTok :
 *  - `ping` (validation de l'endpoint) → à renvoyer tel quel à TikTok ;
 *  - événements de leads (Lead Generation) → capture dans le CRM ;
 *  - autres événements → journalisés.
 */
export async function handleTiktokEvent(body: any): Promise<TikTokEventResult> {
  const type = body?.event_type ?? body?.type ?? body?.event ?? "";

  if (type === "ping") {
    return { ping: true, leads: 0 };
  }

  let captured = 0;
  if (type === "lead" || /lead/i.test(String(type))) {
    const leads = findLeadObjects(body);
    for (const l of leads) {
      try {
        await captureLead({
          source: "tiktok_ads",
          name: (l.name ?? l.full_name ?? "").toString().slice(0, 120) || null,
          email: l.email ? String(l.email) : null,
          phone: l.phone_number ?? l.phone ?? l.phoneNumber ? String(l.phone_number ?? l.phone ?? l.phoneNumber) : null,
        });
        captured++;
      } catch (err) {
        console.error("[tiktok] Lead non capturé :", err);
      }
    }
  } else {
    console.log("[tiktok] Événement reçu :", type, JSON.stringify(body).slice(0, 500));
  }

  return { ping: false, leads: captured };
}
