"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_KEYWORDS = exports.CATEGORIES = void 0;
exports.detectCategory = detectCategory;
exports.selectMediaForTopic = selectMediaForTopic;
const db_1 = require("../db");
/**
 * Sélection intelligente des médias pour un sujet donné :
 * l'agent repère les images grâce à leurs catégories, tags et
 * légendes (métadonnées de la médiathèque) au lieu de prendre
 * simplement les plus récentes.
 */
exports.CATEGORIES = [
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
];
exports.CATEGORY_KEYWORDS = {
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
function detectCategory(text) {
    const t = text.toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const [cat, kws] of Object.entries(exports.CATEGORY_KEYWORDS)) {
        const score = kws.reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0);
        if (score > bestScore) {
            bestScore = score;
            best = cat;
        }
    }
    return bestScore > 0 ? best : null;
}
/** Score de pertinence d'un média pour un sujet. */
function scoreAsset(a, topic) {
    const hay = `${a.category ?? ""} ${a.tags ?? ""} ${a.caption ?? ""} ${a.url}`.toLowerCase();
    let score = 0;
    const topicCategory = detectCategory(topic);
    if (topicCategory && a.category === topicCategory)
        score += 5;
    for (const w of topic.toLowerCase().split(/[^a-zà-ÿ0-9]+/)) {
        if (w.length >= 4 && hay.includes(w))
            score += 1;
    }
    return score;
}
/** Sélectionne les images les plus pertinentes pour un sujet (sinon les plus récentes). */
async function selectMediaForTopic(topic, take = 6) {
    const assets = await db_1.prisma.mediaAsset.findMany({
        where: { type: "image" },
        orderBy: { createdAt: "desc" },
        take: 100,
    });
    const scored = assets.map((a) => ({ a, score: scoreAsset(a, topic) }));
    scored.sort((x, y) => y.score - x.score || y.a.createdAt.getTime() - x.a.createdAt.getTime());
    return scored.slice(0, take).map(({ a }) => ({
        id: a.id,
        url: a.url,
        localPath: a.localPath ?? a.url,
        provider: "library",
    }));
}
//# sourceMappingURL=mediaSelector.js.map