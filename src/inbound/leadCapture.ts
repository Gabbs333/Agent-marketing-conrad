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
 * Nurturing multicanal : envoie l'étape suivante de la séquence
 * (0 accueil, 1 relance, 2 relance, 3 offre) aux leads non convertis
 * dont le dernier contact date de plus de NURTURE_INTERVAL_HOURS.
 */
export async function nurtureLeads(): Promise<{ sent: number }> {
  const cutoff = new Date(Date.now() - config.nurture.intervalHours * 3600 * 1000);
  const leads = await prisma.lead.findMany({
    where: {
      status: { in: ["new", "contacted", "replied", "nurturing"] },
      createdAt: { lt: cutoff },
    },
    include: { messages: { where: { direction: "outbound", status: "sent" } } },
  });

  let sent = 0;
  for (const lead of leads) {
    // Scoring à jour (température hot/warm/cold)
    await scoreLead(lead.id).catch((err) =>
      console.error(`[leads] Scoring impossible pour ${lead.id} :`, err),
    );

    const stage = lead.messages.length;
    if (stage > STAGE_MAX) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "nurturing" } });
      continue;
    }
    const result = await sendNurtureMessage(lead, stage);
    if (result.sent) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: stage === 0 ? "contacted" : "nurturing" },
      });
      sent++;
    }
  }
  return { sent };
}

const STAGE_MAX = 3;

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
        source: input.channel,
        status: "replied",
        notes: `Message entrant : ${input.text.slice(0, 200)}`,
      },
    });
  } else {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "replied" } });
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
