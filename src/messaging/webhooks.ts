import { handleInboundMessage, handleReferral } from "../inbound/leadCapture";
import { classifyMessage, forwardToReceptionist, routerEnabled } from "./router";
import * as whatsapp from "./whatsapp";
import * as messenger from "./messenger";

/**
 * Traitement des webhooks Meta (WhatsApp Cloud API + Messenger).
 *
 * - `field === "messages"` → messages WhatsApp entrants ;
 * - `entry.messaging`       → événements Messenger :
 *     message (texte), messaging_referrals / referral (ouverture via m.me),
 *     messaging_optins (opt-in via plugin/ads).
 *
 * Si RECEPTIONIST_WEBHOOK_URL est configuré, l'agent marketing joue le rôle
 * de répartiteur : il garde les messages à intention marketing et transfère
 * le reste à l'agent réceptionniste (voir ./router.ts).
 */

export interface WebhookStats {
  events: number;
  forwarded: number;
}

export async function handleWebhookEvent(body: any): Promise<WebhookStats> {
  const entries = body?.entry ?? [];
  let events = 0;
  let forwarded = 0;
  const routing = routerEnabled();

  for (const entry of entries) {
    // ── WhatsApp : changes[].value.messages[] ──
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      const hasAdContext = Boolean(change.value?.ad_id);
      const messages: any[] = change.value?.messages ?? [];
      const local: any[] = [];
      const delegate: any[] = [];

      if (routing) {
        for (const msg of messages) {
          const phone = msg.from;
          if (!phone) continue;
          const verdict =
            msg.type === "text"
              ? await classifyMessage({
                  channel: "whatsapp",
                  senderId: String(phone),
                  text: msg.text?.body ?? "",
                  hasAdContext,
                })
              : "reception"; // médias entrants → réceptionniste par défaut
          (verdict === "marketing" ? local : delegate).push(msg);
        }
      } else {
        local.push(...messages);
      }

      for (const msg of local) {
        if (msg.type !== "text") continue;
        try {
          await handleInboundMessage({
            channel: "whatsapp",
            senderId: String(msg.from),
            text: msg.text?.body ?? "",
            messageId: msg.id ? String(msg.id) : undefined,
          });
          events++;
          // Accusé de lecture (coches bleues côté client)
          await whatsapp
            .sendReadReceipt({ to: String(msg.from), messageId: String(msg.id) })
            .catch(() => {});
        } catch (err) {
          console.error("[webhook] WhatsApp entrant non traité :", err);
        }
      }

      if (delegate.length) {
        const ok = await forwardToReceptionist({
          object: body.object,
          entry: [{ ...entry, changes: [{ ...change, value: { ...change.value, messages: delegate } }] }],
        });
        if (ok) {
          forwarded += delegate.length;
        } else {
          // Filet de sécurité : réceptionniste indisponible → on traite ici
          console.error("[router] Réceptionniste indisponible, prise en charge locale.");
          for (const msg of delegate) {
            if (msg.type !== "text") continue;
            try {
              await handleInboundMessage({
                channel: "whatsapp",
                senderId: String(msg.from),
                text: msg.text?.body ?? "",
              });
              events++;
            } catch (err) {
              console.error("[webhook] WhatsApp (repli) non traité :", err);
            }
          }
        }
      }
    }

    // ── Messenger : entry.messaging[] ──
    const delegateEvents: any[] = [];
    for (const event of entry.messaging ?? []) {
      const psid = event.sender?.id;
      if (!psid) continue;

      let verdict: "marketing" | "reception" = "marketing";
      if (routing) {
        if (event.message?.text) {
          verdict = await classifyMessage({
            channel: "messenger",
            senderId: String(psid),
            text: event.message.text,
            hasAdContext: false,
          });
        } else if (event.messaging_referrals || event.referral) {
          const ref = event.messaging_referrals?.[0]?.ref ?? event.referral?.ref ?? "";
          verdict = ref.startsWith("campaign_") ? "marketing" : "reception";
        } else if (event.messaging_optins) {
          verdict = "marketing"; // opt-in = source marketing (plugin/ads)
        } else {
          verdict = "reception"; // pièces jointes, etc. → réceptionniste
        }
      }

      if (verdict === "reception") {
        delegateEvents.push(event);
        continue;
      }

      try {
        if (event.message?.text) {
          await handleInboundMessage({
            channel: "messenger",
            senderId: String(psid),
            text: event.message.text,
            messageId: event.message.mid ? String(event.message.mid) : undefined,
          });
          events++;
          await messenger.markSeen(String(psid)).catch(() => {});
        } else if (event.messaging_referrals || event.referral) {
          const ref = event.messaging_referrals?.[0]?.ref ?? event.referral?.ref ?? "";
          await handleReferral({ psid: String(psid), ref, name: event.sender?.name });
          events++;
        } else if (event.messaging_optins) {
          await handleReferral({ psid: String(psid), ref: event.messaging_optins?.ref ?? "" });
          events++;
        }
      } catch (err) {
        console.error("[webhook] Événement Messenger non traité :", err);
      }
    }

    if (delegateEvents.length) {
      const ok = await forwardToReceptionist({
        object: body.object,
        entry: [{ ...entry, messaging: delegateEvents }],
      });
      if (ok) {
        forwarded += delegateEvents.length;
      } else {
        console.error("[router] Réceptionniste indisponible, événements Messenger ignorés :", delegateEvents.length);
      }
    }
  }

  return { events, forwarded };
}
