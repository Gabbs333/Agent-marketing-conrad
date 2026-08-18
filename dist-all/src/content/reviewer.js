"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewPostText = reviewPostText;
const config_1 = require("../config");
const llm_1 = require("./llm");
function heuristicReview(platform, text) {
    const t = text.trim();
    const issues = [];
    let score = 90;
    if (t.length < 20) {
        score -= 35;
        issues.push({ type: "length", message: "Texte trop court pour engager l'audience." });
    }
    else if (t.length < 60) {
        score -= 15;
        issues.push({ type: "clarity", message: "Texte court — enrichissez l'accroche et les bénéfices." });
    }
    if (!/réserv|reserv|book|découvr|decouvr|profitez|rejoignez|lien en bio/i.test(t)) {
        score -= 25;
        issues.push({ type: "cta", message: "Aucun appel à l'action (réservation, lien…)." });
    }
    if (platform === "tiktok" && !/#/.test(t)) {
        score -= 10;
        issues.push({ type: "hashtags", message: "Hashtags manquants pour la portée TikTok." });
    }
    if (t.length > 2200) {
        score -= 10;
        issues.push({ type: "length", message: "Texte trop long pour la plateforme." });
    }
    const verdict = score >= config_1.config.review.minScore ? "ready" : "needs_work";
    return { score: Math.max(0, score), verdict, issues, correctedText: null, provider: "heuristique" };
}
function parseJson(raw) {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
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
/** Relecture éditoriale d'un post avant publication. */
async function reviewPostText(input) {
    if (config_1.config.demoMode)
        return heuristicReview(input.platform, input.text);
    const prompt = `Révise ce post ${input.platform} pour l'hôtel « ${config_1.config.hotel.name} ».
Ton attendu : ${input.tone ?? "celui de la plateforme"}.
Règles : orthographe et grammaire irréprochables, ton respecté, accroche forte, bénéfices concrets, appel à l'action présent, hashtags pertinents pour TikTok (3-5).
Ne réécris pas inutilement : corrige uniquement ce qui est nécessaire.
Réponds en JSON strict : {"score": 0-100, "verdict": "ready" | "needs_work", "issues": [{"type": "grammar|tone|clarity|cta|length|hashtags", "message": "..."}], "correctedText": "version corrigée complète, ou null si rien à corriger"}

POST À RÉVISER :
${input.text}`;
    const raw = await (0, llm_1.completeText)(prompt, "Tu es un réviseur éditorial senior pour un hôtel de luxe. Réponds uniquement en JSON valide.");
    const parsed = parseJson(raw);
    if (!parsed || typeof parsed.score !== "number") {
        return heuristicReview(input.platform, input.text);
    }
    const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
    const issues = Array.isArray(parsed.issues) ? parsed.issues.slice(0, 10) : [];
    const correctedText = typeof parsed.correctedText === "string" && parsed.correctedText.trim().length > 0
        ? parsed.correctedText.trim()
        : null;
    const verdict = score >= config_1.config.review.minScore && (parsed.verdict !== "needs_work" || score >= 70)
        ? "ready"
        : "needs_work";
    return { score, verdict, issues, correctedText, provider: "llm" };
}
//# sourceMappingURL=reviewer.js.map