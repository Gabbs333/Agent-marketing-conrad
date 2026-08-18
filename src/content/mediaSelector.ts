import { prisma } from "../db";
import type { GeneratedImage } from "../types";

/**
 * Sélection intelligente des médias pour un sujet donné :
 * l'agent repère les images grâce à leurs catégories, tags et
 * légendes (métadonnées de la médiathèque) au lieu de prendre
 * simplement les plus récentes.
 */

export const CATEGORIES = [
  "chambre",
  "suite",
  "spa",
  "piscine",
  "gastronomie",
  "restaurant",
  "exterieur",
  "vue",
  "reception",
  "evenement",
] as const;

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  chambre: ["chambre", "room", "bedroom", "lit", "bed"],
  suite: ["suite", "junior", "royale", "presidentielle", "penthouse"],
  spa: ["spa", "bien-etre", "bien être", "massage", "sauna", "hammam", "detente", "relax"],
  piscine: ["piscine", "pool", "bassin", "jacuzzi"],
  gastronomie: ["gastronom", "chef", "menu", "brunch", "diner", "petit-dejeuner", "breakfast", "cuisine", "gourmet", "food"],
  restaurant: ["restaurant", "bistrot", "table", "terrasse-gastronomique"],
  exterieur: ["exterieur", "terrasse", "jardin", "facade", "garden", "exterior", "outdoor", "rooftop"],
  vue: ["vue", "view", "panoram", "skyline", "coucher", "sunset", "lever", "sunrise", "mer", "ocean"],
  reception: ["reception", "lobby", "hall", "accueil", "conciergerie"],
  evenement: ["evenement", "mariage", "seminaire", "event", "wedding", "conference"],
};

/** Détecte la catégorie la plus probable d'un texte (URL, prompt, légende…). */
export function detectCategory(text: string): string | null {
  const t = text.toLowerCase();
  let best: string | null = null;
  let bestScore = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = kws.reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Score de pertinence d'un média pour un sujet. */
function scoreAsset(a: { category: string | null; tags: string | null; caption: string | null; url: string }, topic: string): number {
  const hay = `${a.category ?? ""} ${a.tags ?? ""} ${a.caption ?? ""} ${a.url}`.toLowerCase();
  let score = 0;
  const topicCategory = detectCategory(topic);
  if (topicCategory && a.category === topicCategory) score += 5;
  for (const w of topic.toLowerCase().split(/[^a-zà-ÿ0-9]+/)) {
    if (w.length >= 4 && hay.includes(w)) score += 1;
  }
  return score;
}

/** Sélectionne les images les plus pertinentes pour un sujet (sinon les plus récentes). */
export async function selectMediaForTopic(topic: string, take = 6): Promise<GeneratedImage[]> {
  const assets = await prisma.mediaAsset.findMany({
    where: { type: "image" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const scored = assets.map((a) => ({ a, score: scoreAsset(a, topic) }));
  scored.sort(
    (x, y) => y.score - x.score || y.a.createdAt.getTime() - x.a.createdAt.getTime(),
  );
  return scored.slice(0, take).map(({ a }) => ({
    id: a.id,
    url: a.url,
    localPath: a.localPath ?? a.url,
    provider: "library",
  }));
}
