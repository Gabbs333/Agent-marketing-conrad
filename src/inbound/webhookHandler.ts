import { prisma } from "../db";

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

  const isWhatsApp = payload.object === "whatsapp_business_account";

  for (const entry of payload.entry) {
    // Cas Messenger (entry.messaging)
    if (entry.messaging) {
      for (const msgEvent of entry.messaging) {
        const senderId = msgEvent.sender?.id;
        const text = msgEvent.message?.text;
        if (!senderId || !text) continue;

        // Étape A : Trouver ou créer le Lead via son identifiant Messenger
        let lead = await prisma.lead.findFirst({
          where: { messengerPsid: senderId },
        });

        if (!lead) {
          lead = await prisma.lead.create({
            data: {
              source: "messenger",
              messengerPsid: senderId,
              name: `Prospect Messenger ${senderId.slice(-6)}`,
              status: "new",
            },
          });
          console.log(`[Webhook] Nouveau lead créé via Messenger : ${lead.id}`);
        }

        // Étape B : Enregistrer le message reçu dans le journal
        await prisma.messageLog.create({
          data: {
            leadId: lead.id,
            channel: "messenger",
            direction: "inbound",
            subject: text.slice(0, 200), // Utilise le texte reçu comme sujet/aperçu
            status: "received",
            externalId: senderId,
          },
        });

        console.log(`[Webhook Messenger] Message loggé pour le lead ${lead.id}: "${text}"`);
      }
    }

    // Cas WhatsApp (entry.changes)
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field === "messages") {
          const value = change.value;
          const message = value.messages?.[0];
          const phone = message?.from;
          const text = message?.text?.body;
          if (!phone || !text) continue;

          // Étape A : Trouver ou créer le Lead via son numéro de téléphone
          let lead = await prisma.lead.findFirst({
            where: { phone },
          });

          if (!lead) {
            lead = await prisma.lead.create({
              data: {
                source: "whatsapp",
                phone,
                name: value.contacts?.[0]?.profile?.name || `Prospect WhatsApp ${phone.slice(-6)}`,
                status: "new",
              },
            });
            console.log(`[Webhook] Nouveau lead créé via WhatsApp : ${lead.id}`);
          }

          // Étape B : Enregistrer le message reçu dans le journal
          await prisma.messageLog.create({
            data: {
              leadId: lead.id,
              channel: "whatsapp",
              direction: "inbound",
              subject: text.slice(0, 200),
              status: "received",
              externalId: message.id || phone,
            },
          });

          console.log(`[Webhook WhatsApp] Message loggé pour le lead ${lead.id}: "${text}"`);
        }
      }
    }
  }
}

/**
 * Traitement des webhooks TikTok
 */
export async function handleTikTokWebhook(payload: any) {
  console.log("[Webhook] Événement TikTok reçu:", JSON.stringify(payload));
}
