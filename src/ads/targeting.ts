import { config } from "../config";
import { httpJson } from "../lib/http";
import { completeText } from "../content/llm";
import { formatAdAccountId } from "./metaAds";

/**
 * Ciblage publicitaire granulaire Meta :
 *  1. le LLM propose des CONCEPTS (villes, régions, intérêts, comportements,
 *     tranche d'âge, genre) centrés sur le marché de l'hôtel ;
 *  2. chaque concept est RÉSOLU en identifiant Meta réel via l'API de
 *     recherche de ciblage (les IDs internes ne se devinent pas) :
 *     - géographie : GET /search?type=adgeolocation&location_types=["city"|"region"]
 *     - intérêts   : GET /search?type=adinterest (taxonomie en anglais)
 *     - comport.   : GET /act_{id}/targetingsearch (recherche unifiée)
 *  3. seuls les concepts résolus sont inclus dans le ciblage final —
 *     les autres sont ignorés (jamais de ciblage approximatif).
 */

const GRAPH_URL = "https://graph.facebook.com/v20.0";

export interface TargetingConcepts {
  countries?: string[];
  cities?: string[];
  regions?: string[];
  interests?: string[];
  behaviors?: string[];
  ageMin?: number;
  ageMax?: number;
  genders?: number[]; // 1 = hommes, 2 = femmes
}

interface SearchHit {
  id: string;
  name: string;
  key?: string;
  type?: string;
}

function parseJson<T>(raw: string): T | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function cleanCodes(list: unknown): string[] {
  return (Array.isArray(list) ? list : [])
    .map(String)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s))
    .slice(0, 2);
}

function cleanLabels(list: unknown, max: number): string[] {
  return (Array.isArray(list) ? list : [])
    .map(String)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 80)
    .slice(0, max);
}

/** Le LLM propose un ciblage granulaire (concepts libres). */
export async function proposeTargeting(opts: {
  topic: string;
  objective?: string;
}): Promise<TargetingConcepts | null> {
  if (config.demoMode) return null;

  const prompt = `Hôtel : ${config.hotel.name} — ${config.hotel.tagline}. Marché principal : Yaoundé, Cameroun.
Campagne : « ${opts.topic} » (objectif : ${opts.objective ?? "awareness"}).
Propose un ciblage Meta Ads granulaire et pertinent :
- cities : 1-5 noms de villes (camerounaises ou de la diaspora) réellement pertinentes, en toutes lettres (ex. « Yaoundé », « Douala », « Paris ») ;
- regions : 0-3 régions (optionnel) ;
- countries : uniquement si aucune ville ne convient (2 codes ISO max) ;
- interests : 1-5 intérêts EN ANGLAIS (taxonomie Meta, ex. « Luxury Travel », « Hotels », « Business Travel ») ;
- behaviors : 0-3 EN ANGLAIS (ex. « Frequent Travelers », « International Travelers ») ;
- age_min / age_max : tranche d'âge adaptée à la campagne ;
- genders : [1] hommes, [2] femmes — vide si mixte.
Réponds en JSON strict : {"cities": [], "regions": [], "countries": [], "interests": [], "behaviors": [], "age_min": 18-65, "age_max": 18-65, "genders": []}`;
  const raw = await completeText(
    prompt,
    "Tu es un expert média planning pour un hôtel de luxe en Afrique centrale. Réponds uniquement en JSON valide.",
  );
  const parsed = parseJson<Record<string, unknown>>(raw);
  if (!parsed) return null;

  const concepts: TargetingConcepts = {
    cities: cleanLabels(parsed.cities, 5),
    regions: cleanLabels(parsed.regions, 3),
    countries: cleanCodes(parsed.countries),
    interests: cleanLabels(parsed.interests, 5),
    behaviors: cleanLabels(parsed.behaviors, 3),
  };
  const ageMin = Math.max(18, Math.min(65, Number(parsed.age_min) || config.adsTargeting.ageMin));
  const ageMax = Math.max(ageMin, Math.min(65, Number(parsed.age_max) || config.adsTargeting.ageMax));
  concepts.ageMin = ageMin;
  concepts.ageMax = ageMax;
  const genders = (Array.isArray(parsed.genders) ? parsed.genders : [])
    .map(Number)
    .filter((g) => g === 1 || g === 2);
  if (genders.length === 1) concepts.genders = genders;

  // Rien de résolvable proposé → null (fallback config)
  if (!concepts.cities?.length && !concepts.regions?.length && !concepts.countries?.length) {
    return null;
  }
  return concepts;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.metaAds.accessToken}` };
}

/** Géographie : GET /search?type=adgeolocation → key de la ville/région. */
async function searchGeo(q: string, locationType: "city" | "region"): Promise<{ key: string; name: string } | null> {
  const params = new URLSearchParams({
    type: "adgeolocation",
    location_types: `["${locationType}"]`,
    q,
    limit: "3",
    locale: "fr_FR",
  });
  const data = await httpJson(`${GRAPH_URL}/search?${params.toString()}`, {
    headers: authHeaders(),
  });
  const hits = (data?.data ?? []) as SearchHit[];
  // On garde le premier résultat du bon type géographique.
  const hit = hits.find((h) => h.type === locationType || h.key);
  if (!hit?.key) return null;
  return { key: hit.key, name: hit.name ?? q };
}

/** Intérêt : GET /search?type=adinterest (taxonomie en anglais). */
async function searchInterest(q: string): Promise<{ id: string; name: string } | null> {
  const params = new URLSearchParams({
    type: "adinterest",
    q,
    limit: "1",
    locale: "en_US",
  });
  const data = await httpJson(`${GRAPH_URL}/search?${params.toString()}`, {
    headers: authHeaders(),
  });
  const hit = (data?.data ?? [])[0] as SearchHit | undefined;
  if (!hit?.id || !/^\d+$/.test(hit.id)) return null;
  return { id: hit.id, name: hit.name ?? q };
}

/** Comportement : recherche unifiée du compte, filtrée sur le type behaviors. */
async function searchBehavior(q: string): Promise<{ id: string; name: string } | null> {
  const account = formatAdAccountId(config.metaAds.adAccountId);
  const params = new URLSearchParams({
    q,
    limit: "3",
    locale: "en_US",
  });
  const data = await httpJson(`${GRAPH_URL}/${account}/targetingsearch?${params.toString()}`, {
    headers: authHeaders(),
  });
  const hits = (data?.data ?? []) as SearchHit[];
  const hit = hits.find((h) => h.type === "behaviors" && /^\d+$/.test(h.id ?? ""));
  if (!hit?.id) return null;
  return { id: hit.id, name: hit.name ?? q };
}

async function resolveGeos(queries: string[], locationType: "city" | "region"): Promise<{ key: string }[]> {
  const out: { key: string }[] = [];
  for (const q of queries) {
    try {
      const hit = await searchGeo(q, locationType);
      if (hit) out.push({ key: hit.key });
    } catch (err) {
      console.warn(`[targeting] « ${q} » (${locationType}) non résolue :`, (err as Error).message);
    }
  }
  return out;
}

async function resolveInterests(queries: string[] | undefined): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const q of queries ?? []) {
    try {
      const hit = await searchInterest(q);
      if (hit) out.push({ id: hit.id, name: hit.name });
    } catch (err) {
      console.warn(`[targeting] Intérêt « ${q} » non résolu :`, (err as Error).message);
    }
  }
  return out;
}

async function resolveBehaviors(queries: string[] | undefined): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const q of queries ?? []) {
    try {
      const hit = await searchBehavior(q);
      if (hit) out.push({ id: hit.id, name: hit.name });
    } catch (err) {
      console.warn(`[targeting] Comportement « ${q} » non résolu :`, (err as Error).message);
    }
  }
  return out;
}

/** Résout les concepts en ciblage Meta final (IDs réels uniquement). */
export async function resolveTargeting(concepts: TargetingConcepts): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  // Géographie : villes/régions (précises) priment sur les pays.
  const cities = await resolveGeos(concepts.cities ?? [], "city");
  const regions = await resolveGeos(concepts.regions ?? [], "region");
  const geo: Record<string, unknown> = {};
  if (cities.length) geo.cities = cities;
  if (regions.length) geo.regions = regions;
  if (!cities.length && !regions.length && concepts.countries?.length) {
    geo.countries = concepts.countries;
  }
  if (Object.keys(geo).length) out.geo_locations = geo;

  const interests = await resolveInterests(concepts.interests);
  if (interests.length) out.interests = interests;

  const behaviors = await resolveBehaviors(concepts.behaviors);
  if (behaviors.length) out.behaviors = behaviors;

  const ageMin = Math.max(18, Math.min(65, concepts.ageMin ?? config.adsTargeting.ageMin));
  const ageMax = Math.max(ageMin, Math.min(65, concepts.ageMax ?? config.adsTargeting.ageMax));
  out.age_min = ageMin;
  out.age_max = ageMax;

  if (concepts.genders?.length === 1) out.genders = concepts.genders;

  return out;
}

/** Pipeline complet : concepts IA → résolution → ciblage final (ou null si échec). */
export async function buildAiTargeting(opts: {
  topic: string;
  objective?: string;
}): Promise<Record<string, unknown> | null> {
  const concepts = await proposeTargeting(opts);
  if (!concepts) return null;
  return resolveTargeting(concepts);
}
