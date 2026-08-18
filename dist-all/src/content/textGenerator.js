"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePostText = generatePostText;
exports.generateVideoScript = generateVideoScript;
exports.generateAdCopy = generateAdCopy;
exports.generateEmailContent = generateEmailContent;
const config_1 = require("../config");
const llm_1 = require("./llm");
/**
 * Générateur de contenus textuels via LLM (OpenAI par défaut).
 * En mode démo (DEMO_MODE=true) ou sans clé API, des gabarits intégrés
 * sont utilisés pour que tout le pipeline reste testable hors ligne.
 */
const PLATFORM_GUIDES = {
    facebook: "Post Facebook pour la page de l'hôtel. Structure : accroche, 2-3 phrases de bénéfices, preuve (situation, note, avis), appel à l'action vers la réservation, 4-5 hashtags.",
    tiktok: "Caption TikTok dynamique : accroche percutante en 1 ligne, phrases très courtes, CTA direct (réserver, lien en bio), 4-5 hashtags tendance voyage.",
    instagram: "Légende Instagram : 2-3 phrases, émojis, 6-8 hashtags voyage.",
    ads: "Réponds en JSON strict : {\"headline\": string (max 40 caractères), \"primaryText\": string (max 125 caractères), \"cta\": string (max 15 caractères)}.",
    email: "Réponds en JSON strict : {\"subject\": string, \"body\": string (HTML simple)}.",
    web: "Réponds en JSON strict : {\"headline\": string, \"subheadline\": string, \"benefits\": [string, string, string]}.",
};
function systemPrompt(platform, tone) {
    const lang = config_1.config.contentLanguage === "fr" ? "français" : config_1.config.contentLanguage;
    const guide = PLATFORM_GUIDES[platform] ?? PLATFORM_GUIDES.web;
    return `Tu es un expert en marketing hôtelier pour l'hôtel « ${config_1.config.hotel.name} ». Ton : ${tone}. Langue : ${lang}. Réponds uniquement avec le contenu demandé, sans commentaire. ${guide}`;
}
async function complete(prompt, system) {
    return (0, llm_1.completeText)(prompt, system);
}
function parseJson(raw) {
    const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
    try {
        return JSON.parse(cleaned);
    }
    catch {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(cleaned.slice(start, end + 1));
            }
            catch {
                /* ignore */
            }
        }
    }
    return null;
}
const HASHTAGS = "#Hotel #Voyage #Escapade #WeekEnd #Séjour";
function demoPostText(platform, topic) {
    const hotel = config_1.config.hotel.name;
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
async function generatePostText(opts) {
    const tone = opts.tone ?? "chaleureux et professionnel";
    const text = await complete(`Sujet du post : ${opts.topic}`, systemPrompt(opts.platform, tone));
    return text || demoPostText(opts.platform, opts.topic);
}
function demoScript(topic) {
    const hotel = config_1.config.hotel.name;
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
function normalizeScript(s) {
    return {
        title: typeof s.title === "string" ? s.title : "Découvrez notre hôtel",
        hook: typeof s.hook === "string" ? s.hook : "",
        scenes: Array.isArray(s.scenes)
            ? s.scenes.map((sc) => ({
                visual: String(sc.visual ?? ""),
                narration: String(sc.narration ?? ""),
                durationSec: Math.max(2, Number(sc.durationSec) || 4),
            }))
            : [],
        cta: typeof s.cta === "string" ? s.cta : "Réservez maintenant",
    };
}
async function generateVideoScript(opts) {
    const dur = opts.durationSec ?? 15;
    const prompt = `Écris le script d'une vidéo sociale de ${dur} secondes pour ${config_1.config.hotel.name} sur le thème : ${opts.topic}. Réponds en JSON strict : {"title": string, "hook": string, "scenes": [{"visual": string, "narration": string, "durationSec": number}], "cta": string}. La somme des durationSec doit être proche de ${dur}.`;
    const raw = await complete(prompt, "Tu es un scénariste de vidéos sociales. Réponds uniquement en JSON valide.");
    const parsed = parseJson(raw);
    if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
        return normalizeScript(parsed);
    }
    return demoScript(opts.topic);
}
async function generateAdCopy(opts) {
    const prompt = `Objectif de campagne : ${opts.objective}. Offre : ${opts.offer}. Rédige la copy publicitaire (Meta/TikTok).`;
    const raw = await complete(prompt, systemPrompt("ads", "urgent et incitatif"));
    const parsed = parseJson(raw);
    if (parsed?.headline && parsed.primaryText)
        return parsed;
    const demo = parseJson(demoPostText("ads", opts.offer));
    return demo ?? { headline: opts.offer, primaryText: opts.offer, cta: "Réserver" };
}
function demoEmail(stage, leadName) {
    const hotel = config_1.config.hotel.name;
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
async function generateEmailContent(opts) {
    const prompt = `Écris un email de stade « ${opts.stage} » pour un lead${opts.leadName ? ` nommé ${opts.leadName}` : ""} de l'hôtel ${config_1.config.hotel.name}. Offre : ${opts.offer ?? "remise de 10%"}.`;
    const raw = await complete(prompt, systemPrompt("email", "chaleureux et professionnel"));
    const parsed = parseJson(raw);
    if (parsed?.subject && parsed.body)
        return parsed;
    return demoEmail(opts.stage, opts.leadName ?? "");
}
//# sourceMappingURL=textGenerator.js.map