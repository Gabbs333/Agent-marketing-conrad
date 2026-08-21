import { config } from "../config";
import { prisma } from "../db";
import * as messenger from "../messaging/messenger";
import * as whatsapp from "../messaging/whatsapp";
import type { Channel, MessageResult } from "../types";
import { emailTemplate, sendEmail } from "./email";

/**
 * Orchestration du nurturing multicanal (email / WhatsApp / Messenger).
 * Chaque envoi est journalisé dans MessageLog (direction, canal, statut).
 */

export interface MessagingTarget {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  messengerPsid: string | null;
  preferredChannel?: string | null;
}

const STAGE_KIND = ["welcome", "followup1", "followup2", "offer"] as const;

function firstName(lead: MessagingTarget): string {
  return lead.name?.trim().split(/\s+/)[0] || "cher client";
}

function channelAvailable(channel: Channel, lead: MessagingTarget): boolean {
  if (channel === "email") return !!lead.email;
  if (channel === "whatsapp") return !!lead.phone;
  return !!lead.messengerPsid;
}

function channelConfigured(channel: Channel): boolean {
  if (config.demoMode) return true;
  if (channel === "email") return !!(config.email.host && config.email.user);
  if (channel === "whatsapp") return !!(config.whatsapp.phoneNumberId && config.whatsapp.accessToken);
  return !!(config.messenger.pageId && config.messenger.pageToken);
}

function messengerText(kind: (typeof STAGE_KIND)[number], name: string): string {
  const hotel = config.hotel.name;
  const agent = config.agent.name;
  switch (kind) {
    case "welcome":
      return `Bonjour ${name} 👋 Je suis ${agent}, votre conseiller dédié à ${hotel} ! ${config.hotel.tagline}. Dites-moi vos dates de séjour, je vous réponds très vite.`;
    case "followup1":
      return `Bonjour ${name} ✨ Votre escapade à ${hotel} est toujours disponible. Réservez sous 48h et profitez de ${config.marketing.offer} !`;
    case "followup2":
      return `Dernière chance ${name} 🏨 ${config.marketing.offer} chez ${hotel}, annulation flexible et petit-déjeuner inclus. Réservez maintenant !`;
    default:
      return `Bonjour ${name} 🌅 Une offre rien que pour vous à ${hotel} : ${config.marketing.offer}. À très vite !`;
  }
}

async function logMessage(
  leadId: string,
  channel: Channel,
  subject: string,
  status: "sent" | "failed",
  externalId: string | null,
  error?: string,
): Promise<void> {
  await prisma.messageLog.create({
    data: {
      leadId,
      channel,
      subject: subject.slice(0, 500),
      status,
      externalId,
      sentAt: status === "sent" ? new Date() : null,
    },
  });
  if (error) console.error(`[messaging] Échec ${channel} (lead ${leadId}) :`, error);
}

function subjectFor(channel: Channel, stage: number, lead: MessagingTarget): string {
  const kind = STAGE_KIND[Math.min(stage, STAGE_KIND.length - 1)];
  if (channel === "email") return emailTemplate(kind, { name: firstName(lead) }).subject;
  if (channel === "whatsapp") {
    const tpl =
      stage === 0
        ? config.whatsapp.templateWelcome
        : stage === 1
          ? config.whatsapp.templateFollowup
          : config.whatsapp.templateOffer;
    return `Template WhatsApp : ${tpl}`;
  }
  return `Messenger : ${messengerText(kind, firstName(lead)).slice(0, 80)}`;
}

async function dispatch(
  channel: Channel,
  stage: number,
  lead: MessagingTarget,
): Promise<MessageResult> {
  const kind = STAGE_KIND[Math.min(stage, STAGE_KIND.length - 1)];
  const name = firstName(lead);

  if (channel === "email") {
    const tpl = emailTemplate(kind, { name, offer: config.marketing.offer });
    const r = await sendEmail({ to: lead.email!, subject: tpl.subject, html: tpl.html });
    return { sent: r.sent, demo: r.demo };
  }
  if (channel === "whatsapp") {
    const tplName =
      stage === 0
        ? config.whatsapp.templateWelcome
        : stage === 1
          ? config.whatsapp.templateFollowup
          : config.whatsapp.templateOffer;
    return whatsapp.sendTemplateMessage({
      to: lead.phone!,
      template: tplName,
      params: [name, config.hotel.name, config.marketing.offer],
    });
  }
  return messenger.sendText({
    psid: lead.messengerPsid!,
    text: messengerText(kind, name),
  });
}

/**
 * Envoie le message de l'étape `stage` sur le premier canal disponible
 * (ordre défini par NURTURE_CHANNELS), ou le canal forcé si précisé.
 */
export async function sendNurtureMessage(
  lead: MessagingTarget,
  stage: number,
  forcedChannel?: Channel,
): Promise<{ channel: Channel | null; sent: boolean; demo: boolean; error?: string }> {
  // Canal forcé > canal préféré du lead > ordre configuré
  const base = config.nurture.channels;
  const channels = forcedChannel
    ? [forcedChannel]
    : lead.preferredChannel && (base as string[]).includes(lead.preferredChannel)
      ? [lead.preferredChannel as Channel, ...base.filter((c) => c !== lead.preferredChannel)]
      : base;
  const channel = channels.find(
    (c) => channelAvailable(c, lead) && channelConfigured(c),
  );

  if (!channel) {
    const err = "Aucun canal disponible/configuré pour ce lead";
    await logMessage(lead.id, "email", "Nurture", "failed", null, err);
    return { channel: null, sent: false, demo: config.demoMode, error: err };
  }

  const subject = subjectFor(channel, stage, lead);
  try {
    const result = await dispatch(channel, stage, lead);
    await logMessage(lead.id, channel, subject, "sent", result.messageId ?? null);
    return { channel, sent: true, demo: result.demo };
  } catch (err) {
    const msg = (err as Error).message;
    await logMessage(lead.id, channel, subject, "failed", null, msg);
    return { channel, sent: false, demo: false, error: msg };
  }
}

/** Réponse automatique immédiate (fenêtre 24 h) après un message entrant.
 * `textOverride` : réponse IA contextuelle ; sinon gabarit de secours. */
export async function sendAutoReply(
  lead: MessagingTarget,
  channel: "whatsapp" | "messenger",
  textOverride?: string,
): Promise<{ sent: boolean; demo: boolean }> {
  const name = firstName(lead);
  const hotel = config.hotel.name;
  try {
    const text =
      textOverride ||
      (channel === "whatsapp"
        ? `Bonjour ${name} ! Je suis ${config.agent.name}, votre conseiller à ${hotel} ☀️ Dites-moi vos dates de séjour et je m'occupe du reste.`
        : `Bonjour ${name} ! Je suis ${config.agent.name}, votre conseiller à ${hotel} ☀️ Quelles dates vous intéressent ?`);
    const result =
      channel === "whatsapp"
        ? await whatsapp.sendTextMessage({ to: lead.phone!, text })
        : await messenger.sendText({ psid: lead.messengerPsid!, text });
    await logMessage(lead.id, channel, textOverride ? "Réponse IA" : "Réponse automatique", "sent", result.messageId ?? null);
    return { sent: true, demo: result.demo };
  } catch (err) {
    await logMessage(lead.id, channel, "Réponse automatique", "failed", null, (err as Error).message);
    return { sent: false, demo: false };
  }
}
