import { config } from "../config";
import { completeText } from "./llm";
import type { AdCopy, EmailContent, VideoScript } from "../types";

/**
 * Générateur de contenus textuels via LLM (OpenAI par défaut).
 * En mode démo (DEMO_MODE=true) ou sans clé API, des gabarits intégrés
 * sont utilisés pour que tout le pipeline reste testable hors ligne.
 */

const PLATFORM_GUIDES: Record<string, string> = {
  facebook:
    "Post Facebook pour la page de l'hôtel. Structure : accroche, 2-3 phrases de bénéfices, preuve (situation, note, avis), appel à l'action vers la réservation, 4-5 hashtags.",
  tiktok:
    "Caption TikTok dynamique : accroche percutante en 1 ligne, phrases très courtes, CTA direct (réserver, lien en bio), 4-5 hashtags tendance voyage.",
  instagram:
    "Légende Instagram : 2-3 phrases, émojis, 6-8 hashtags voyage.",
  ads: "Réponds en JSON strict : {\"headline\": string (max 40 caractères), \"primaryText\": string (max 125 caractères), \"cta\": string (max 15 caractères)}.",
  email:
    "Réponds en JSON strict : {\"subject\": string, \"body\": string (HTML simple)}.",
  web: "Réponds en JSON strict : {\"headline\": string, \"subheadline\": string, \"benefits\": [string, string, string]}.",
};

function systemPrompt(platform: string, tone: string): string {
  const lang = config.contentLanguage === "fr" ? "français" : config.contentLanguage;
  const guide = PLATFORM_GUIDES[platform] ?? PLATFORM_GUIDES.web;
  return `Tu es un expert en marketing hôtelier pour l'hôtel « ${config.hotel.name} ». Ton : ${tone}. Langue : ${lang}. Réponds uniquement avec le contenu demandé, sans commentaire. ${guide}`;
}

async function complete(prompt: string, system?: string): Promise<string> {
  return completeText(prompt, system);
}

function parseJson<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
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

const HASHTAGS = "#Hotel #Voyage #Escapade #WeekEnd #Séjour";

function demoPostText(platform: string, topic: string): string {
  const hotel = config.hotel.name;
  const title = topic.charAt(0).toUpperCase() + topic.slice(1);
  switch (platform) {
    case "tiktok":
      return `✨ ${title} : l'expérience ${hotel} à ne pas manquer !\n\nImaginez : un réveil doré, une vue à couper le souffle et un service aux petits soins. 🌅\n\n📍 ${hotel}\n👉 Réservez maintenant, lien en bio !\n\n#hotel #voyage #tiktoktravel #escapade #bonplan`;
    case "facebook":
      return `🌸 ${title} — ${hotel} vous ouvre ses portes.\n\nProfitez d'un cadre d'exception, d'un accueil chaleureux et d'offres pensées pour vos escapades.\n\n👉 Réservez votre séjour dès aujourd'hui : lien en bio.\n\n${HASHTAGS}`;
    case "ads":
      return JSON.stringify({
        headline: `${title} à ${hotel}`,
        primaryText: `Réveillez-vous autrement. ${hotel} : offres exclusives, annulation flexible, petit-déjeuner inclus. Réservez en 2 minutes.`,
        cta: "Réserver maintenant",
      });
    case "web":
      return JSON.stringify({
        headline: `${title} — vivez l'expérience ${hotel}`,
        subheadline: "Séjours d'exception, offres exclusives et annulation flexible.",
        benefits: [
          "Chambres élégantes avec vue",
          "Petit-déjeuner gastronomique inclus",
          "Spa & piscine en libre accès",
        ],
      });
    default:
      return `${title} — ${hotel} vous attend pour une expérience inoubliable. Réservez votre séjour ! ${HASHTAGS}`;
  }
}

export async function generatePostText(opts: {
  platform: string;
  topic: string;
  tone?: string;
}): Promise<string> {
  const tone = opts.tone ?? "chaleureux et professionnel";
  const text = await complete(`Sujet du post : ${opts.topic}`, systemPrompt(opts.platform, tone));
  return text || demoPostText(opts.platform, opts.topic);
}

function demoScript(topic: string): VideoScript {
  const hotel = config.hotel.name;
  return {
    title: topic,
    hook: "Et si votre prochaine escapade commençait ici ?",
    scenes: [
      {
        visual: "Façade de l'hôtel au lever du soleil",
        narration: `Bienvenue à ${hotel}, votre refuge au cœur de la ville.`,
        durationSec: 4,
      },
      {
        visual: "Chambre lumineuse, lit king size",
        narration: "Des chambres élégantes, pensées pour votre confort.",
        durationSec: 4,
      },
      {
        visual: "Spa et piscine intérieure",
        narration: "Détendez-vous dans notre spa, à deux pas de votre chambre.",
        durationSec: 4,
      },
      {
        visual: "Petit-déjeuner gastronomique",
        narration: "Et commencez chaque journée par un petit-déjeuner d'exception.",
        durationSec: 4,
      },
    ],
    cta: "Réservez votre séjour dès maintenant — lien en bio.",
  };
}

function normalizeScript(s: any): VideoScript {
  return {
    title: typeof s.title === "string" ? s.title : "Découvrez notre hôtel",
    hook: typeof s.hook === "string" ? s.hook : "",
    scenes: Array.isArray(s.scenes)
      ? s.scenes.map((sc: any) => ({
          visual: String(sc.visual ?? ""),
          narration: String(sc.narration ?? ""),
          durationSec: Math.max(2, Number(sc.durationSec) || 4),
        }))
      : [],
    cta: typeof s.cta === "string" ? s.cta : "Réservez maintenant",
  };
}

export async function generateVideoScript(opts: {
  topic: string;
  durationSec?: number;
}): Promise<VideoScript> {
  const dur = opts.durationSec ?? 15;
  const prompt = `Écris le script d'une vidéo sociale de ${dur} secondes pour ${config.hotel.name} sur le thème : ${opts.topic}. Réponds en JSON strict : {"title": string, "hook": string, "scenes": [{"visual": string, "narration": string, "durationSec": number}], "cta": string}. La somme des durationSec doit être proche de ${dur}.`;
  const raw = await complete(prompt, "Tu es un scénariste de vidéos sociales. Réponds uniquement en JSON valide.");
  const parsed = parseJson<VideoScript>(raw);
  if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
    return normalizeScript(parsed);
  }
  return demoScript(opts.topic);
}

export async function generateAdCopy(opts: {
  objective: string;
  offer: string;
}): Promise<AdCopy> {
  const prompt = `Objectif de campagne : ${opts.objective}. Offre : ${opts.offer}. Rédige la copy publicitaire (Meta/TikTok).`;
  const raw = await complete(prompt, systemPrompt("ads", "urgent et incitatif"));
  const parsed = parseJson<AdCopy>(raw);
  if (parsed?.headline && parsed.primaryText) return parsed;
  const demo = parseJson<AdCopy>(demoPostText("ads", opts.offer));
  return demo ?? { headline: opts.offer, primaryText: opts.offer, cta: "Réserver" };
}

/**
 * Ciblage publicitaire proposé par l'IA pour une campagne donnée :
 * pays (codes ISO 3166-1 alpha-2) et tranche d'âge, centrés sur le
 * marché de l'hôtel (Cameroun + marchés secondaires pertinents).
 * Renvoie null si le LLM est indisponible → le backend retombe sur
 * le ciblage par défaut de la configuration.
 */
export async function generateAdTargeting(opts: {
  topic: string;
  objective?: string;
}): Promise<Record<string, unknown> | null> {
  if (config.demoMode) return null;

  const prompt = `Hôtel : ${config.hotel.name} — ${config.hotel.tagline}. Marché principal : Yaoundé, Cameroun.
Campagne : « ${opts.topic} » (objectif : ${opts.objective ?? "awareness"}).
Propose un ciblage géographique et démographique Meta Ads pertinent : le Cameroun en priorité, plus éventuellement 1-4 pays secondaires (diaspora, voisins) seulement si cela sert réellement la campagne.
Réponds en JSON strict : {"countries": ["CM", ...], "age_min": 18-65, "age_max": 18-65}.`;
  const raw = await complete(
    prompt,
    "Tu es un expert média planning pour un hôtel de luxe en Afrique centrale. Réponds uniquement en JSON valide.",
  );
  const parsed = parseJson<{ countries?: unknown; age_min?: unknown; age_max?: unknown }>(raw);
  if (!parsed) return null;

  const countries = (Array.isArray(parsed.countries) ? parsed.countries : [])
    .map(String)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c))
    .slice(0, 25);
  if (countries.length === 0) return null;

  const ageMin = Math.max(18, Math.min(65, Number(parsed.age_min) || config.adsTargeting.ageMin));
  const ageMax = Math.max(ageMin, Math.min(65, Number(parsed.age_max) || config.adsTargeting.ageMax));

  return {
    geo_locations: { countries },
    age_min: ageMin,
    age_max: ageMax,
  };
}

function demoEmail(stage: string, leadName: string): EmailContent {
  const hotel = config.hotel.name;
  const name = leadName ? ` ${leadName}` : "";
  switch (stage) {
    case "welcome":
      return {
        subject: `Merci${name} ! Votre séjour à ${hotel} vous attend 🌅`,
        body: `<p>Bonjour${name},</p><p>Merci pour votre intérêt pour ${hotel}. Réservez dès aujourd'hui et profitez de nos meilleurs tarifs.</p><p>À très vite,<br/>L'équipe ${hotel}</p>`,
      };
    case "followup1":
      return {
        subject: `Votre escapade à ${hotel} est toujours disponible ✨`,
        body: `<p>Bonjour${name},</p><p>Nous gardons votre chambre au chaud ! Bénéficiez de 10% de remise si vous réservez sous 48h.</p><p>L'équipe ${hotel}</p>`,
      };
    case "followup2":
      return {
        subject: `Dernière chance : offre exclusive ${hotel} 🏨`,
        body: `<p>Bonjour${name},</p><p>Notre offre exclusive expire bientôt. Annulation flexible et petit-déjeuner inclus.</p><p>Réservez maintenant !</p>`,
      };
    default:
      return {
        subject: `Une offre rien que pour vous — ${hotel}`,
        body: `<p>Bonjour${name},</p><p>Découvrez nos offres du moment à ${hotel}.</p><p>L'équipe ${hotel}</p>`,
      };
  }
}

export async function generateEmailContent(opts: {
  stage: "welcome" | "followup1" | "followup2" | "offer";
  leadName?: string;
  offer?: string;
}): Promise<EmailContent> {
  const prompt = `Écris un email de stade « ${opts.stage} » pour un lead${opts.leadName ? ` nommé ${opts.leadName}` : ""} de l'hôtel ${config.hotel.name}. Offre : ${opts.offer ?? "remise de 10%"}.`;
  const raw = await complete(prompt, systemPrompt("email", "chaleureux et professionnel"));
  const parsed = parseJson<EmailContent>(raw);
  if (parsed?.subject && parsed.body) return parsed;
  return demoEmail(opts.stage, opts.leadName ?? "");
}
