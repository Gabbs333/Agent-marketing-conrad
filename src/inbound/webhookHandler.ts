import { prisma } from "../db";
import { config } from "../config";

/**
 * Traitement des webhooks Meta (WhatsApp / Messenger)
 * 1. Vérification du type d'événement
 * 2. Extraction des données (expéditeur, message, etc.)
 * 3. Logique métier : capture de lead, réponse auto, nurturing
 */
export async function handleMetaWebhook(payload: any) {
  if (payload.object !== "page" && payload.object !== "whatsapp_business_account") {
    return;
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field === "messages") {
        const message = change.value.messages?.[0];
        const senderId = message?.from;
        if (!senderId) continue;

        // Log du message reçu
        await prisma.messageLog.create({
          data: {
            channel: change.value.metadata?.phone_number_id ? "whatsapp" : "messenger",
            externalId: senderId,
            direction: "inbound",
            content: message.text?.body || "Non textuel",
          },
        });

        // Ici : appeler un service de réponse IA ou de capture de lead
        console.log(`[Webhook] Message reçu de ${senderId}:`, message.text?.body);
      }
    }
  }
}

/**
 * Traitement des webhooks TikTok
 */
export async function handleTikTokWebhook(payload: any) {
  // TikTok nécessite une vérification de signature HMAC (si nécessaire)
  console.log("[Webhook] Événement TikTok reçu:", JSON.stringify(payload));
}
