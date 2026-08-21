import { config } from "../config";
import { prisma } from "../db";
import { completeText } from "./llm";
import { escalationPhonesText, type Temperature } from "../inbound/scoring";

/**
 * Réponses conversationnelles de Surya, l'agent marketing (WhatsApp/Messenger).
 *  - contexte long : jusqu'aux 100 derniers messages de la conversation ;
 *  - rôle strictement marketing : la conciergerie est orientée vers la réception ;
 *  - escalade humaine SITUATIONNELLE : le LLM détecte colère, réclamation,
 *    urgence, blocage ou demande hors marketing — sans que le client ait à
 *    demander explicitement « un humain » ;
 *  - offres : proposées selon la température du lead (hot/warm/cold) ;
 *  - Surya ne révèle jamais être une IA.
 * En mode démo ou sans LLM : renvoie une réponse vide (gabarit de repli).
 */

const CONTEXT_MESSAGES = 100;

/** Mots-clés déclenchant une escalade immédiate (chemin déterministe rapide). */
const ESCALATION_KEYWORDS = [
  "humain",
  "personne reelle",
  "parler a quelqu",
  "parler à quelqu",
  "plainte",
  "reclamation",
  "remboursement",
  "avocat",
  "directeur",
  "responsable",
  "menace",
  "urgence",
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Vrai si le message exige une intervention humaine (escalade immédiate). */
export function needsHumanEscalation(text: string): boolean {
  const t = norm(text);
  return ESCALATION_KEYWORDS.some((k) => t.includes(norm(k)));
}

/** Message d'escalade partagé quand un humain doit prendre le relais. */
export function escalationMessage(): string {
  const phones = escalationPhonesText(config.agent.escalationPhones);
  return `Je comprends 🙏 Pour une prise en charge immédiate, notre équipe est joignable directement au ${phones}. Je peux aussi transmettre votre dossier à un conseiller qui vous rappellera dans les plus brefs délais.`;
}

export interface InboundAnalysis {
  escalate: boolean;
  reply: string;
}

function parseJson(raw: string): { escalate?: boolean; reply?: string } | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(cleaned.slice(s, e + 1));
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function offerInstruction(temperature: Temperature): string {
  if (temperature === "hot") {
    return `Le lead est CHAUD. Propose naturellement l'offre en cours (« ${config.marketing.offer} ») et pousse à la réservation (demander les dates, le nombre de voyageurs).`;
  }
  if (temperature === "warm") {
    return `Le lead est TIÈDE. Mentionne l'offre en cours (« ${config.marketing.offer} ») pour créer l'envie, sans forcer.`;
  }
  return "Le lead est FROID. Qualifie d'abord son besoin (dates, budget, composition du séjour) avant d'évoquer une offre.";
}

function systemPrompt(temperature: Temperature, firstContact: boolean): string {
  const greeting = firstContact
    ? "PREMIER CONTACT : présente-toi en UNE phrase sobre (« Bonjour, je suis ${config.agent.name}, conseiller à ${config.hotel.name} »), puis réponds."
    : "CONVERSATION DÉJÀ ENGAGÉE : ne salue PAS, ne te re-présente PAS, ne répète pas le nom de l'hôtel inutilement. Réponds directement, dans la continuité naturelle de l'historique, comme un humain qui suit le fil de la conversation.";
  return `Tu es ${config.agent.name}, conseiller marketing de l'hôtel « ${config.hotel.name} ». ${config.hotel.tagline}.
Ton rôle est STRICTEMENT marketing : acquisition de clients, offres, réservations, fidélisation, relances.
Tu ne gères PAS la conciergerie ni le service en chambre : oriente poliment le client vers l'équipe de la réception.

RÈGLE D'ESCALADE (cruciale) : mets escalate = true dès que la situation exige une intervention humaine, même si le client ne le demande pas explicitement :
- colère, insulte, menace, réclamation, demande de remboursement ou d'annulation litigieuse ;
- urgence (santé, sécurité, incident pendant un séjour) ;
- question déjà posée plusieurs fois sans réponse satisfaisante, client qui s'impatiente ;
- négociation complexe (tarifs de groupe, événements, contrats) ;
- demande totalement hors marketing (bagages, room service, ménage, technique…).
Ne partage alors pas les numéros toi-même : le système s'en charge.

RÈGLES DE RÉDACTION (reply) :
- Réponds en français, ton chaleureux et professionnel ;
- ${greeting}
- ne révèle JAMAIS que tu es une IA ou un robot ;
- 3 phrases maximum, 80 mots maximum, adapté à WhatsApp (pas de markdown, pas d'astérisques, pas de listes) ;
- 2 émojis maximum ;
- varie tes formulations : ne commence jamais deux réponses par la même formule ;
- Ne jamais inventer de prix, de disponibilités ou d'offres qui ne figurent pas dans l'historique ;
- Termine souvent par une question pour faire avancer la conversation.
${offerInstruction(temperature)}

Réponds UNIQUEMENT en JSON strict, sans aucun commentaire : {"escalate": true|false, "reply": "..."}`;
}

/** Analyse le message entrant : détection d'escalade situationnelle + réponse. */
export async function analyzeInbound(
  userText: string,
  leadId: string,
  temperature: Temperature = "cold",
): Promise<InboundAnalysis> {
  if (config.demoMode) return { escalate: false, reply: "" };

  const history = await prisma.messageLog.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    take: CONTEXT_MESSAGES,
  });
  const ordered = history.reverse();
  const lines = ordered
    .filter((m) => m.subject)
    .map((m) => `${m.direction === "inbound" ? "Client" : "Agent"} : ${m.subject}`)
    .join("\n");

  // Premier contact = l'agent n'a encore jamais écrit dans cette conversation
  const firstContact = !history.some((m) => m.direction === "outbound");

  const prompt = lines
    ? `Historique de la conversation :\n${lines}\n\nDernier message du client : ${userText}`
    : `Dernier message du client : ${userText}`;

  const raw = await completeText(prompt, systemPrompt(temperature, firstContact));
  const parsed = parseJson(raw);
  if (parsed && typeof parsed.reply === "string") {
    return { escalate: parsed.escalate === true, reply: parsed.reply };
  }
  // Repli : le texte brut est traité comme une réponse sans escalade
  return { escalate: false, reply: raw.trim() || "" };
}
