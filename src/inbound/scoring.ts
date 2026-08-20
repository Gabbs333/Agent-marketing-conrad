import { prisma } from "../db";

/**
 * Scoring marketing des leads : calcule un score 0-100 et une température
 * (hot ≥ 70, warm ≥ 40, cold < 40) à partir des signaux disponibles :
 *  - source du lead (publicité, referral, canal…) ;
 *  - volume et récence des messages échangés ;
 *  - mots-clés d'intention forte (réservation, prix, dates…) ou d'intérêt ;
 *  - réservations existantes et statut du lead.
 *
 * Appelé à chaque message entrant et lors du nurturing pour garder
 * le scoring à jour dans le temps.
 */

export type Temperature = "hot" | "warm" | "cold";

/** Intention d'achat forte : le prospect veut réserver/acheter maintenant. */
const HOT_INTENT = [
  "reserver",
  "reservation",
  "booking",
  "book",
  "dates",
  "disponib",
  "dispo",
  "prix",
  "tarif",
  "combien",
  "payer",
  "regler",
  "confirme",
  "confirmer",
  "valider",
  "code promo",
  "promo",
  "offre",
];

/** Intérêt marqué sans passage à l'acte. */
const WARM_INTENT = [
  "sejour",
  "stay",
  "weekend",
  "week-end",
  "vacances",
  "nuit",
  "nights",
  "hotel",
  "conrad",
  "suite",
  "chambre",
  "spa",
  "piscine",
  "restaurant",
  "petit-dejeuner",
  "breakfast",
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export function temperatureOf(score: number): Temperature {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

/** Recalcule le score d'un lead et persiste score + température. */
export async function scoreLead(leadId: string): Promise<{ score: number; temperature: Temperature }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { messages: true, bookings: true },
  });
  if (!lead) throw new Error("Lead introuvable");

  let score = 0;

  // ── Source du lead ──
  const source = norm(lead.source ?? "");
  if (/(ads|ad|pub|campaign|referral)/.test(source)) score += 10;
  else if (/(whatsapp|messenger|m\.me|landing)/.test(source)) score += 6;

  // ── Engagement (messages) ──
  const inbound = lead.messages.filter((m) => m.direction === "inbound");
  const outbound = lead.messages.filter((m) => m.direction === "outbound");
  score += Math.min(inbound.length * 3, 30); // volume de relances
  if (outbound.length > 0) score += 5; // on a déjà communiqué avec lui

  const texts = norm(lead.messages.map((m) => m.subject ?? "").join(" "));
  let hotHit = 0;
  let warmHit = 0;
  for (const kw of HOT_INTENT) if (texts.includes(kw)) hotHit++;
  for (const kw of WARM_INTENT) if (texts.includes(kw)) warmHit++;
  score += Math.min(hotHit * 4, 24);
  score += Math.min(warmHit * 2, 12);

  // ── Récence du dernier contact ──
  const last = lead.messages.reduce<Date | null>(
    (acc, m) => (m.createdAt > (acc ?? new Date(0)) ? m.createdAt : acc),
    null,
  );
  if (last) {
    const hours = (Date.now() - last.getTime()) / 3_600_000;
    if (hours <= 24) score += 20;
    else if (hours <= 72) score += 12;
    else if (hours <= 24 * 7) score += 6;
    else if (hours <= 24 * 30) score += 2;
  }

  // ── Réservations & statut ──
  if (lead.bookings.length > 0) score += 40;
  if (lead.status === "booked") score += 10;
  else if (lead.status === "replied") score += 6;

  score = Math.max(0, Math.min(100, score));
  const temperature = temperatureOf(score);

  await prisma.lead.update({
    where: { id: leadId },
    data: { score, temperature },
  });
  return { score, temperature };
}

/** Numéros d'escalade formatés pour un message client. */
export function escalationPhonesText(phones: string[]): string {
  const fmt = (p: string) =>
    p.length === 9 ? `${p.slice(0, 3)} ${p.slice(3, 5)} ${p.slice(5, 7)} ${p.slice(7)}` : p;
  return phones.map(fmt).join(" ou ");
}
