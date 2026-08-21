import { config } from "../config";
import { prisma } from "../db";
import { analyzeInbound, escalationMessage, needsHumanEscalation } from "../content/chatReply";
import { scoreLead } from "./scoring";
import { sendAutoReply, sendNurtureMessage } from "./messaging";

/**
 * Capture de leads (inbound) et conversion en réservations :
 *  - déduplication par email / téléphone / PSID Messenger ;
 *  - rattachement à la campagne source (landing page, m.me, WhatsApp…) ;
 *  - accueil immédiat sur le premier canal disponible ;
 *  - nurturing multicanal programmé (email, WhatsApp, Messenger) ;
 *  - messages entrants (webhooks) : création/mise à jour + réponse auto ;
 *  - conversion en réservation (Booking) avec mise à jour du statut.
 */

export interface LeadInput {
  campaignId?: string | null;
  source?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  messengerPsid?: string | null;
  consent?: boolean;
}

export async function captureLead(input: LeadInput): Promise<{ lead: any; isNew: boolean }> {
  if (!input.email && !input.phone && !input.messengerPsid) {
    throw new Error("Un email, un téléphone ou un PSID Messenger est requis");
  }

  const where = input.email
    ? { email: input.email }
    : input.phone
      ? { phone: input.phone }
      : { messengerPsid: input.messengerPsid ?? undefined };
  const existing = await prisma.lead.findFirst({ where });
  if (existing) return { lead: existing, isNew: false };

  const lead = await prisma.lead.create({
    data: {
      campaignId: input.campaignId ?? null,
      source: input.source ?? "landing_page",
      name: input.name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      messengerPsid: input.messengerPsid ?? null,
      status: "new",
    },
  });

  // Message d'accueil sur le premier canal disponible (journalisé dans MessageLog)
  await sendNurtureMessage(lead, 0).catch((err) =>
    console.error("[leads] Message d'accueil impossible :", err),
  );
  return { lead, isNew: true };
}

export interface BookingInput {
  checkIn: string;
  checkOut: string;
  guests?: number;
  roomType?: string;
  amount?: number;
}

export async function convertToBooking(leadId: string, input: BookingInput): Promise<any> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error("Lead introuvable");

  const checkIn = new Date(input.checkIn);
  const checkOut = new Date(input.checkOut);
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    throw new Error("Dates de séjour invalides");
  }

  const booking = await prisma.booking.create({
    data: {
      leadId,
      campaignId: lead.campaignId,
      checkIn,
      checkOut,
      guests: input.guests ?? null,
      roomType: input.roomType ?? null,
      amount: input.amount ?? null,
      status: "confirmed",
    },
  });

  await prisma.lead.update({ where: { id: leadId }, data: { status: "booked" } });

  await prisma.performance.create({
    data: {
      entityType: "campaign",
      entityId: lead.campaignId ?? "direct",
      platform: "inbound",
      metric: "bookings",
      value: 1,
    },
  });
  return booking;
}

/**
 * Nurturing multicanal avancé : envoie l'étape suivante de la séquence
 * (0 accueil, 1 relance, 2 relance, 3 offre) aux leads non convertis.
 *  - cadence adaptée à la température : chaud = NURTURE_HOT_INTERVAL_HOURS
 *    (accéléré, poussé vers l'offre), tiède = intervalle normal,
 *    froid = intervalle doublé ;
 *  - fenêtre horaire d'envoi (NURTURE_HOURS, ex. « 8-20 ») pour ne jamais
 *    écrire en pleine nuit ;
 *  - intervalle mesuré depuis le DERNIER message sortant (et non la création) ;
 *  - canal préféré du lead (dernier canal utilisé) prioritaire.
 */
export async function nurtureLeads(): Promise<{ sent: number; skipped: number }> {
  if (!withinBusinessHours()) {
    console.log("[nurture] Hors fenêtre horaire autorisée, envois différés.");
    return { sent: 0, skipped: 0 };
  }

  const leads = await prisma.lead.findMany({
    where: {
      status: { in: ["new", "contacted", "replied", "nurturing"] },
    },
    include: {
      messages: {
        where: { direction: "outbound", status: "sent" },
        orderBy: { createdAt: "desc" },
        take: 6,
      },
    },
  });

  let sent = 0;
  let skipped = 0;
  for (const lead of leads) {
    const { temperature } = await scoreLead(lead.id).catch((err) => {
      console.error(`[leads] Scoring impossible pour ${lead.id} :`, err);
      return { score: 0, temperature: "cold" as const };
    });

    // Cadence selon la température
    const interval =
      temperature === "hot"
        ? config.nurture.hotIntervalHours
        : temperature === "cold"
          ? config.nurture.intervalHours * 2
          : config.nurture.intervalHours;

    const lastOutbound = lead.messages[0];
    if (
      lastOutbound &&
      Date.now() - lastOutbound.createdAt.getTime() < interval * 3600 * 1000
    ) {
      skipped++;
      continue;
    }

    let stage = lead.messages.length;
    if (stage > STAGE_MAX) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "nurturing" } });
      skipped++;
      continue;
    }

    // Lead chaud : accélérer directement vers la relance forte (offre incluse)
    if (temperature === "hot") stage = Math.max(stage, 2);

    const result = await sendNurtureMessage(lead, stage);
    if (result.sent) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: stage === 0 ? "contacted" : "nurturing" },
      });
      sent++;
    } else {
      skipped++;
    }
  }
  return { sent, skipped };
}

/** Fenêtre horaire d'envoi autorisée dans le fuseau de l'hôtel. */
export function withinBusinessHours(): boolean {
  const range = config.nurture.hours;
  if (!range || !range.includes("-")) return true;
  const [start, end] = range.split("-").map((n) => Number(n.trim()));
  if (Number.isNaN(start) || Number.isNaN(end)) return true;
  try {
    const hour =
      Number(
        new Intl.DateTimeFormat("fr-FR", {
          hour: "numeric",
          hour12: false,
          timeZone: config.nurture.timezone,
        })
          .format(new Date())
          .replace(/\D/g, ""),
      ) % 24;
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  } catch {
    return true; // fuseau invalide → ne bloque pas le nurturing
  }
}

const STAGE_MAX = 3;

/** Mots-clés d'opt-out (conformité) : le lead demande à ne plus être contacté. */
const OPT_OUT_KEYWORDS = [
  "stop",
  "arretez",
  "arrêtez",
  "ne m'ecrivez plus",
  "ne m'écrivez plus",
  "ne me contactez plus",
  "desabonnez",
  "désabonnez",
  "unsubscribe",
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Vrai si le message est une demande d'arrêt des envois. */
export function isOptOut(text: string): boolean {
  const t = norm(text);
  return OPT_OUT_KEYWORDS.some((k) => t.includes(norm(k)));
}

/** Message entrant WhatsApp/Messenger : crée le lead s'il n'existe pas, répond automatiquement.
 * `messageId` (id Meta du message) permet d'éviter les doublons lors des retries de webhook. */
export async function handleInboundMessage(input: {
  channel: "whatsapp" | "messenger";
  senderId: string;
  text: string;
  messageId?: string;
}): Promise<any> {
  // Déduplication : Meta peut renvoyer le même événement si la réponse tarde
  if (input.messageId) {
    const dup = await prisma.messageLog.findFirst({
      where: { externalId: input.messageId, direction: "inbound" },
      select: { id: true },
    });
    if (dup) return null;
  }

  const where =
    input.channel === "whatsapp"
      ? { phone: input.senderId }
      : { messengerPsid: input.senderId };
  let lead = await prisma.lead.findFirst({ where });

  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        phone: input.channel === "whatsapp" ? input.senderId : null,
        messengerPsid: input.channel === "messenger" ? input.senderId : null,
        preferredChannel: input.channel,
        source: input.channel,
        status: "replied",
        notes: `Message entrant : ${input.text.slice(0, 200)}`,
      },
    });
  } else {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "replied", preferredChannel: input.channel },
    });
  }

  // Opt-out (conformité) : le lead demande l'arrêt des envois
  if (isOptOut(input.text)) {
    await prisma.messageLog.create({
      data: {
        leadId: lead.id,
        channel: input.channel,
        direction: "inbound",
        status: "received",
        subject: input.text.slice(0, 180),
        externalId: input.messageId ?? null,
        sentAt: new Date(),
      },
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "unsubscribed" },
    });
    await sendAutoReply(
      lead,
      input.channel,
      "C'est noté 🙏 Nous ne vous recontacterons plus. Bonne continuation et à bientôt au Conrad Grand Luxury Hotel.",
    ).catch((err) => console.error("[leads] Confirmation d'opt-out impossible :", err));
    return lead;
  }

  await prisma.messageLog.create({
    data: {
      leadId: lead.id,
      channel: input.channel,
      direction: "inbound",
      status: "received",
      subject: input.text.slice(0, 180),
      externalId: input.messageId ?? null,
      sentAt: new Date(),
    },
  });

  // Scoring du lead (intention, récence, source, réservations)
  const { temperature } = await scoreLead(lead.id).catch((err) => {
    console.error("[leads] Scoring impossible, température par défaut :", err);
    return { score: 0, temperature: "cold" as const };
  });

  // Réponse : escalade humaine (situationnelle ou explicite), sinon réponse IA
  let replyText: string | undefined;
  if (needsHumanEscalation(input.text)) {
    replyText = escalationMessage();
  } else {
    const { escalate, reply } = await analyzeInbound(input.text, lead.id, temperature).catch((err) => {
      console.error("[leads] Analyse IA impossible, gabarit utilisé :", err);
      return { escalate: false, reply: "" };
    });
    replyText = escalate ? escalationMessage() : reply || undefined;
  }

  // Réponse automatique dans la fenêtre de 24 h
  await sendAutoReply(lead, input.channel, replyText).catch((err) =>
    console.error("[leads] Réponse automatique impossible :", err),
  );
  return lead;
}

/** Référencement m.me (campaign_xxx) : crée le lead Messenger rattaché à la campagne. */
export async function handleReferral(input: {
  psid: string;
  ref?: string;
  name?: string;
}): Promise<any> {
  const existing = await prisma.lead.findFirst({
    where: { messengerPsid: input.psid },
  });
  if (existing) return existing;

  let campaignId: string | null = null;
  const rawRef = input.ref ?? "";
  if (rawRef.startsWith("campaign_")) {
    const candidate = rawRef.slice("campaign_".length);
    const campaign = await prisma.campaign.findUnique({ where: { id: candidate } });
    if (campaign) campaignId = candidate;
  }

  const lead = await prisma.lead.create({
    data: {
      messengerPsid: input.psid,
      name: input.name ?? null,
      source: "messenger",
      campaignId,
      status: "new",
    },
  });

  await sendNurtureMessage(lead, 0, "messenger").catch((err) =>
    console.error("[leads] Accueil Messenger impossible :", err),
  );
  return lead;
}
