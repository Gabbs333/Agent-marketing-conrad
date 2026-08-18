"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishPostRecord = publishPostRecord;
exports.runCampaign = runCampaign;
exports.publishScheduledPosts = publishScheduledPosts;
exports.syncPerformance = syncPerformance;
const config_1 = require("./config");
const db_1 = require("./db");
const textGenerator_1 = require("./content/textGenerator");
const imageGenerator_1 = require("./content/imageGenerator");
const videoGenerator_1 = require("./content/videoGenerator");
const mediaCollector_1 = require("./content/mediaCollector");
const mediaSelector_1 = require("./content/mediaSelector");
const reviewer_1 = require("./content/reviewer");
const facebook_1 = require("./social/facebook");
const tiktok_1 = require("./social/tiktok");
const metaAds = __importStar(require("./ads/metaAds"));
const tiktokAds = __importStar(require("./ads/tiktokAds"));
const files_1 = require("./lib/files");
/** Publie un post (texte, photo ou vidéo) sur sa plateforme et met à jour la base.
 *  Relecture IA automatique du texte avant publication (désactivable via `force`). */
async function publishPostRecord(postId, opts = {}) {
    const post = await db_1.prisma.post.findUnique({ where: { id: postId } });
    if (!post)
        throw new Error("Post introuvable");
    let review = null;
    if (!opts.force && post.status !== "published") {
        review = await (0, reviewer_1.reviewPostText)({ platform: post.platform, text: post.text });
        const text = review.correctedText ?? post.text;
        await db_1.prisma.post.update({
            where: { id: postId },
            data: { text, reviewScore: review.score, reviewIssues: JSON.stringify(review.issues) },
        });
        post.text = text;
        if (review.verdict === "needs_work") {
            await db_1.prisma.post.update({ where: { id: postId }, data: { status: "needs_review" } });
            throw new Error(`Relecture IA refusée (${review.score}/100) : ${review.issues.map((i) => i.message).join(" — ")}`);
        }
    }
    const mediaPath = post.mediaUrl ? (0, files_1.resolveMediaPath)(post.mediaUrl) : undefined;
    let externalId = null;
    if (post.platform === "facebook") {
        const r = await (0, facebook_1.publishToFacebook)({
            text: post.text,
            mediaPath,
            mediaType: post.mediaType ?? undefined,
        });
        externalId = r.id;
    }
    else if (post.platform === "tiktok") {
        if (!mediaPath) {
            throw new Error("TikTok nécessite un média (photo ou vidéo)");
        }
        if (post.mediaType === "video") {
            const r = await (0, tiktok_1.uploadAndPublishVideo)({ videoPath: mediaPath, caption: post.text });
            externalId = r.id;
        }
        else {
            const r = await (0, tiktok_1.publishPhoto)({ imagePath: mediaPath, caption: post.text });
            externalId = r.id;
        }
    }
    else {
        throw new Error(`Plateforme inconnue : ${post.platform}`);
    }
    const updated = await db_1.prisma.post.update({
        where: { id: postId },
        data: { externalId, status: "published", publishedAt: new Date() },
    });
    return { postId, externalId: updated.externalId, review };
}
/** Exécute le pipeline complet d'une campagne. */
async function runCampaign(campaignId, opts = {}) {
    const campaign = await db_1.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign)
        throw new Error("Campagne introuvable");
    const platforms = opts.platforms ?? ["facebook", "tiktok"];
    const topic = campaign.name;
    const summary = { campaignId, posts: [], media: [], ads: [], errors: [] };
    // 1. Textes par plateforme (ton propre à la campagne)
    const campaignTone = campaign.tone ?? "chaleureux et incitatif";
    for (const platform of platforms) {
        const text = await (0, textGenerator_1.generatePostText)({ platform, topic, tone: campaignTone });
        const post = await db_1.prisma.post.create({
            data: {
                campaignId,
                platform,
                type: "text",
                text,
                status: opts.publishNow ? "ready" : "draft",
            },
        });
        summary.posts.push({ id: post.id, platform, status: post.status });
    }
    // 2. Médias de campagne : les images de la médiathèque sont choisies
    //    par pertinence avec le sujet (catégories/tags/légendes), sinon
    //    collecte du site, sinon génération IA.
    let libraryImages = await (0, mediaSelector_1.selectMediaForTopic)(topic, 6);
    if (libraryImages.length === 0 && /^https?:\/\//.test(config_1.config.hotel.website)) {
        try {
            const collected = await (0, mediaCollector_1.collectMediaFromSite)({ url: config_1.config.hotel.website, max: 6 });
            libraryImages = collected.assets.map((a) => ({
                id: a.id,
                url: a.url,
                localPath: a.localPath,
                provider: "library",
            }));
            summary.media.push(...collected.assets.map((a) => ({ id: a.id, type: a.type })));
        }
        catch (err) {
            summary.errors.push(`Collecte des médias du site : ${err.message}`);
        }
    }
    let image;
    if (libraryImages.length > 0) {
        image = libraryImages[0];
    }
    else {
        image = await (0, imageGenerator_1.generateImage)({
            prompt: `Photo professionnelle de ${config_1.config.hotel.name} — ${topic}, lumière dorée, haute qualité`,
            size: "1024x1024",
        });
        libraryImages.push(image);
    }
    summary.media.push({ id: image.id, type: "image" });
    const fbPost = summary.posts.find((p) => p.platform === "facebook");
    if (fbPost) {
        await db_1.prisma.post.update({
            where: { id: fbPost.id },
            data: { mediaUrl: image.url, mediaType: "image" },
        });
    }
    // TikTok exige un média : on attache l'image de campagne (remplacée
    // par la vidéo si opts.withVideo).
    const ttPost = summary.posts.find((p) => p.platform === "tiktok");
    if (ttPost) {
        await db_1.prisma.post.update({
            where: { id: ttPost.id },
            data: { mediaUrl: image.url, mediaType: "image", type: "photo" },
        });
    }
    // 3. Vidéo TikTok (optionnelle) — assemblée à partir des vraies images
    //    de la médiathèque (jusqu'à 4 scènes distinctes)
    if (opts.withVideo && ttPost) {
        try {
            const script = await (0, textGenerator_1.generateVideoScript)({ topic, durationSec: 15 });
            const images = [...new Set([...libraryImages.map((i) => i.localPath), image.localPath])].slice(0, 4);
            const video = await (0, videoGenerator_1.generateCampaignVideo)({
                script,
                images,
                withVoice: !config_1.config.demoMode,
            });
            await db_1.prisma.post.update({
                where: { id: ttPost.id },
                data: { mediaUrl: video.url, mediaType: "video", type: "video" },
            });
            summary.media.push({ id: video.id, type: "video" });
        }
        catch (err) {
            summary.errors.push(`Vidéo : ${err.message}`);
        }
    }
    // 4. Publication
    if (opts.publishNow) {
        for (const p of summary.posts.filter((x) => x.status === "ready")) {
            try {
                await publishPostRecord(p.id);
            }
            catch (err) {
                summary.errors.push(`Publication ${p.platform} : ${err.message}`);
            }
        }
    }
    // 5. Publicités (optionnelles, si budget)
    if (opts.withAds && campaign.budget) {
        // Meta Ads
        try {
            const copy = await (0, textGenerator_1.generateAdCopy)({ objective: campaign.objective, offer: topic });
            const mc = await metaAds.createCampaign({
                name: `${campaign.name} — Meta`,
                objective: campaign.objective,
                dailyBudget: campaign.budget,
                startDate: campaign.startDate ?? undefined,
                endDate: campaign.endDate ?? undefined,
            });
            const adset = await metaAds.createAdSet({
                campaignId: mc.id,
                name: `${campaign.name} — Ad Set`,
                dailyBudget: campaign.budget,
            });
            const creative = await metaAds.createAdCreative({
                name: `${campaign.name} — Créatif`,
                message: copy.primaryText,
                mediaPath: image.localPath,
                mediaType: "image",
            });
            const ad = await metaAds.createAd({
                name: `${campaign.name} — Annonce`,
                adsetId: adset.id,
                creativeId: creative.id,
            });
            await db_1.prisma.ad.create({
                data: {
                    campaignId,
                    platform: "meta",
                    name: `${campaign.name} — Annonce`,
                    budget: campaign.budget,
                    externalId: ad.id,
                    creativeId: creative.id,
                    status: "paused",
                },
            });
            summary.ads.push({ platform: "meta", id: ad.id });
        }
        catch (err) {
            summary.errors.push(`Meta Ads : ${err.message}`);
        }
        // TikTok Ads
        try {
            const tc = await tiktokAds.createCampaign({
                name: `${campaign.name} — TikTok`,
                budget: campaign.budget,
            });
            const ag = await tiktokAds.createAdGroup({
                campaignId: tc.id,
                name: `${campaign.name} — Ad Group`,
                budget: campaign.budget,
            });
            let videoId;
            const tt = await db_1.prisma.post.findFirst({
                where: { campaignId, platform: "tiktok", mediaType: "video" },
            });
            if (tt?.mediaUrl) {
                videoId = await tiktokAds.uploadVideoCreative(tt.mediaUrl);
            }
            const ta = await tiktokAds.createAd({
                adGroupId: ag.id,
                name: `${campaign.name} — Annonce`,
                videoId,
            });
            await db_1.prisma.ad.create({
                data: {
                    campaignId,
                    platform: "tiktok",
                    name: `${campaign.name} — Annonce`,
                    budget: campaign.budget,
                    externalId: ta.id,
                    status: "paused",
                },
            });
            summary.ads.push({ platform: "tiktok", id: ta.id });
        }
        catch (err) {
            summary.errors.push(`TikTok Ads : ${err.message}`);
        }
    }
    await db_1.prisma.campaign.update({ where: { id: campaignId }, data: { status: "active" } });
    return summary;
}
/** Publie tous les posts planifiés dont l'heure est arrivée. */
async function publishScheduledPosts() {
    const due = await db_1.prisma.post.findMany({
        where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    });
    let count = 0;
    for (const post of due) {
        try {
            await publishPostRecord(post.id);
            count++;
        }
        catch (err) {
            console.error(`[scheduler] Publication impossible (${post.id}) :`, err);
        }
    }
    return count;
}
function demoMetrics() {
    return {
        post_impressions: 800 + Math.floor(Math.random() * 3000),
        post_engagements: 60 + Math.floor(Math.random() * 400),
        post_clicks: 10 + Math.floor(Math.random() * 120),
    };
}
/** Récupère les performances des posts publiés et les enregistre. */
async function syncPerformance() {
    const posts = await db_1.prisma.post.findMany({
        where: { status: "published", externalId: { not: null } },
        take: 100,
    });
    let records = 0;
    for (const post of posts) {
        try {
            const metrics = post.platform === "facebook" && post.externalId
                ? await (0, facebook_1.getPostInsights)(post.externalId)
                : demoMetrics();
            for (const [metric, value] of Object.entries(metrics)) {
                await db_1.prisma.performance.create({
                    data: { entityType: "post", entityId: post.id, platform: post.platform, metric, value },
                });
                records++;
            }
        }
        catch (err) {
            console.error(`[performance] Échec pour le post ${post.id} :`, err);
        }
    }
    return records;
}
//# sourceMappingURL=pipeline.js.map