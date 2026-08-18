import { config } from "../config";
import { httpJson } from "../lib/http";
import type { MessageResult } from "../types";

/**
 * WhatsApp Business via la Meta Cloud API :
 *  - messages de type « template » (seuls autorisés pour initier une
 *    conversation hors fenêtre de 24 h) ;
 *  - messages texte libres (dans la fenêtre de 24 h après un message client).
 */

const GRAPH_URL = "https://graph.facebook.com/v20.0";

function demo(message: string): MessageResult {
  console.log(`[whatsapp][demo] ${message}`);
  return { sent: true, demo: true, messageId: `demo_wa_${Date.now()}` };
}

function requireConfig(): { phoneNumberId: string; accessToken: string } {
  const { phoneNumberId, accessToken } = config.whatsapp;
  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "WHATSAPP_PHONE_NUMBER_ID et WHATSAPP_ACCESS_TOKEN manquants (ou DEMO_MODE=true sans API réelle)",
    );
  }
  return { phoneNumberId, accessToken };
}

/**
 * Envoie un template approuvé (Meta Business Manager).
 * `params` remplit les variables {{1}}, {{2}}, … du template.
 */
export async function sendTemplateMessage(input: {
  to: string;
  template: string;
  language?: string;
  params?: string[];
}): Promise<MessageResult> {
  if (config.demoMode) {
    return demo(
      `Template « ${input.template} » → ${input.to} (params : ${(input.params ?? []).join(", ")})`,
    );
  }
  const { phoneNumberId, accessToken } = requireConfig();
  const data = await httpJson<{ messages?: { id: string }[] }>(
    `${GRAPH_URL}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "template",
        template: {
          name: input.template,
          language: { code: input.language ?? "fr" },
          ...(input.params?.length
            ? {
                components: [
                  {
                    type: "body",
                    parameters: input.params.map((p) => ({ type: "text", text: p })),
                  },
                ],
              }
            : {}),
        },
      }),
    },
  );
  return { sent: true, demo: false, messageId: data.messages?.[0]?.id };
}

/** Texte libre — uniquement dans la fenêtre de 24 h après un message du client. */
export async function sendTextMessage(input: {
  to: string;
  text: string;
}): Promise<MessageResult> {
  if (config.demoMode) {
    return demo(`Texte → ${input.to} : ${input.text.slice(0, 80)}`);
  }
  const { phoneNumberId, accessToken } = requireConfig();
  const data = await httpJson<{ messages?: { id: string }[] }>(
    `${GRAPH_URL}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { body: input.text, preview_url: false },
      }),
    },
  );
  return { sent: true, demo: false, messageId: data.messages?.[0]?.id };
}

/**
 * Message réactif (réponse automatique) dans la fenêtre de 24 h.
 * Utilise un texte libre plutôt qu'un template.
 */
export async function sendQuickReply(input: {
  to: string;
  text: string;
  contextMessageId?: string;
}): Promise<MessageResult> {
  return sendTextMessage({ to: input.to, text: input.text });
}
