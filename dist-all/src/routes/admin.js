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
exports.adminRoutes = adminRoutes;
const node_path_1 = require("node:path");
const zod_1 = require("zod");
const config_1 = require("../config");
const db_1 = require("../db");
const textGenerator_1 = require("../content/textGenerator");
const imageGenerator_1 = require("../content/imageGenerator");
const mediaCollector_1 = require("../content/mediaCollector");
const videoGenerator_1 = require("../content/videoGenerator");
const pipeline_1 = require("../pipeline");
const leadCapture_1 = require("../inbound/leadCapture");
const messaging_1 = require("../inbound/messaging");
const webhooks_1 = require("../messaging/webhooks");
const messenger_1 = require("../messaging/messenger");
const tiktok_1 = require("../social/tiktok");
const facebook_1 = require("../social/facebook");
const status_1 = require("../integrations/status");
const persist_1 = require("../integrations/persist");
const files_1 = require("../lib/files");
const tones_1 = require("../content/tones");
const reviewer_1 = require("../content/reviewer");
const calendar_1 = require("../content/calendar");
const metaAds = __importStar(require("../ads/metaAds"));
const tiktokAds = __importStar(require("../ads/tiktokAds"));
function parse(schema, body) {
    const r = schema.safeParse(body);
    if (!r.success) {
        return {
            ok: false,
            error: r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
        };
    }
    return { ok: true, data: r.data };
}
// ─── Schémas ──────────────────────────────────────────────────
const campaignSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    platform: zod_1.z.string().default("multi"),
    objective: zod_1.z.string().default("awareness"),
    tone: zod_1.z.string().optional(),
    budget: zod_1.z.number().int().positive().optional(),
    startDate: zod_1.z.string().optional(),
    endDate: zod_1.z.string().optional(),
    autoRun: zod_1.z.boolean().default(false),
});
const campaignPatchSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).optional(),
    objective: zod_1.z.string().optional(),
    tone: zod_1.z.string().nullable().optional(),
    budget: zod_1.z.number().int().positive().nullable().optional(),
    status: zod_1.z.string().optional(),
});
const runSchema = zod_1.z.object({
    platforms: zod_1.z.array(zod_1.z.enum(["facebook", "tiktok"])).optional(),
    publishNow: zod_1.z.boolean().default(false),
    withVideo: zod_1.z.boolean().default(false),
    withAds: zod_1.z.boolean().default(false),
});
const textSchema = zod_1.z.object({
    platform: zod_1.z.string().min(1),
    topic: zod_1.z.string().min(1),
    tone: zod_1.z.string().optional(),
});
const scriptSchema = zod_1.z.object({
    topic: zod_1.z.string().min(1),
    durationSec: zod_1.z.number().int().positive().optional(),
});
const imageSchema = zod_1.z.object({
    prompt: zod_1.z.string().min(1),
    provider: zod_1.z.enum(["auto", "openai", "stability", "replicate", "fal", "huggingface", "together", "getimg", "local"]).optional(),
    size: zod_1.z.string().optional(),
});
const videoSchema = zod_1.z.object({
    topic: zod_1.z.string().min(1),
    images: zod_1.z.array(zod_1.z.string()).optional(),
    durationSec: zod_1.z.number().int().positive().optional(),
    withVoice: zod_1.z.boolean().default(false),
    mode: zod_1.z.enum(["auto", "ffmpeg", "ai", "replicate", "fal"]).optional(),
});
const emailContentSchema = zod_1.z.object({
    stage: zod_1.z.enum(["welcome", "followup1", "followup2", "offer"]),
    leadName: zod_1.z.string().optional(),
    offer: zod_1.z.string().optional(),
});
const collectSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    max: zod_1.z.number().int().min(1).max(50).optional(),
});
const fetchMediaSchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    category: zod_1.z.string().optional(),
    caption: zod_1.z.string().optional(),
    tags: zod_1.z.string().optional(),
});
const mediaPatchSchema = zod_1.z.object({
    category: zod_1.z.string().nullable().optional(),
    caption: zod_1.z.string().nullable().optional(),
    tags: zod_1.z.string().nullable().optional(),
});
const calendarSlotSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    platform: zod_1.z.enum(["facebook", "tiktok"]),
    dayOfWeek: zod_1.z.number().int().min(1).max(7),
    time: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
    type: zod_1.z.enum(["text", "photo", "video"]),
    topic: zod_1.z.string().min(2),
    tone: zod_1.z.string().optional(),
    enabled: zod_1.z.boolean().optional(),
});
const calendarGenerateSchema = zod_1.z.object({
    days: zod_1.z.number().int().min(1).max(14).optional(),
});
const postSchema = zod_1.z.object({
    campaignId: zod_1.z.string().optional(),
    platform: zod_1.z.string().min(1),
    text: zod_1.z.string().optional(),
    topic: zod_1.z.string().optional(),
    mediaId: zod_1.z.string().optional(),
    type: zod_1.z.string().default("text"),
});
const scheduleSchema = zod_1.z.object({ scheduledAt: zod_1.z.string().min(1) });
const postPatchSchema = zod_1.z.object({
    text: zod_1.z.string().min(1).optional(),
});
const publishSchema = zod_1.z.object({
    force: zod_1.z.boolean().default(false),
});
const reviewSchema = zod_1.z.object({
    apply: zod_1.z.boolean().default(true),
});
const adSchema = zod_1.z.object({
    campaignId: zod_1.z.string().optional(),
    name: zod_1.z.string().min(1),
    objective: zod_1.z.string().optional(),
    budget: zod_1.z.number().int().positive().optional(),
    targeting: zod_1.z.record(zod_1.z.unknown()).optional(),
});
const leadSchema = zod_1.z
    .object({
    campaignId: zod_1.z.string().optional(),
    source: zod_1.z.string().default("landing_page"),
    name: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().optional(),
    consent: zod_1.z.boolean().default(true),
})
    .refine((d) => d.email || d.phone, { message: "email ou phone requis" });
const bookingSchema = zod_1.z.object({
    checkIn: zod_1.z.string().min(1),
    checkOut: zod_1.z.string().min(1),
    guests: zod_1.z.number().int().positive().optional(),
    roomType: zod_1.z.string().optional(),
    amount: zod_1.z.number().int().positive().optional(),
});
const trackSchema = zod_1.z.object({
    campaignId: zod_1.z.string().optional(),
    event: zod_1.z.string().default("pageview"),
    utm_source: zod_1.z.string().optional(),
});
const messageSchema = zod_1.z.object({
    channel: zod_1.z.enum(["email", "whatsapp", "messenger"]).optional(),
    stage: zod_1.z.number().int().min(0).max(3).default(1),
});
const otnSchema = zod_1.z.object({
    psid: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    payload: zod_1.z.string().min(1),
});
const facebookConnectSchema = zod_1.z.object({
    userToken: zod_1.z.string().min(20),
    pageId: zod_1.z.string().optional(),
    persist: zod_1.z.boolean().default(false),
});
const tiktokAuthUrlSchema = zod_1.z.object({ redirectUri: zod_1.z.string().min(1) });
const tiktokConnectSchema = zod_1.z.object({
    code: zod_1.z.string().min(1),
    redirectUri: zod_1.z.string().min(1),
    persist: zod_1.z.boolean().default(false),
});
async function adminRoutes(app) {
    // ─── Santé ──────────────────────────────────────────────────
    app.get("/health", async () => ({
        ok: true,
        service: "hotel-marketing-agent",
        demoMode: config_1.config.demoMode,
    }));
    // ─── Dashboard ──────────────────────────────────────────────
    app.get("/dashboard", async () => {
        const [campaigns, posts, ads, totalLeads, newLeads, bookedLeads, bookings, revenue, spend, messages] = await Promise.all([
            db_1.prisma.campaign.count(),
            db_1.prisma.post.count(),
            db_1.prisma.ad.count(),
            db_1.prisma.lead.count(),
            db_1.prisma.lead.count({ where: { status: "new" } }),
            db_1.prisma.lead.count({ where: { status: "booked" } }),
            db_1.prisma.booking.count(),
            db_1.prisma.booking.aggregate({ _sum: { amount: true } }),
            db_1.prisma.performance.aggregate({ _sum: { value: true }, where: { metric: "spend" } }),
            db_1.prisma.messageLog.count(),
        ]);
        return {
            campaigns,
            posts,
            ads,
            leads: { total: totalLeads, new: newLeads, booked: bookedLeads },
            bookings: { total: bookings, revenue: revenue._sum.amount ?? 0 },
            spend: spend._sum.value ?? 0,
            messages,
        };
    });
    // ─── Campagnes ──────────────────────────────────────────────
    app.post("/campaigns", async (req, reply) => {
        const p = parse(campaignSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        const { name, platform, objective, tone, budget, startDate, endDate, autoRun } = p.data;
        const campaign = await db_1.prisma.campaign.create({
            data: {
                name,
                platform,
                objective,
                tone: tone ?? null,
                budget: budget ?? null,
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
            },
        });
        if (autoRun) {
            try {
                await (0, pipeline_1.runCampaign)(campaign.id, {});
            }
            catch (err) {
                return reply.code(201).send({ campaign, warning: err.message });
            }
        }
        return reply.code(201).send(campaign);
    });
    app.get("/campaigns", async () => db_1.prisma.campaign.findMany({
        include: { _count: { select: { posts: true, leads: true, bookings: true } } },
        orderBy: { createdAt: "desc" },
    }));
    app.get("/campaigns/:id", async (req, reply) => {
        const campaign = await db_1.prisma.campaign.findUnique({
            where: { id: req.params.id },
            include: { posts: true, ads: true, leads: true, bookings: true },
        });
        if (!campaign)
            return reply.code(404).send({ error: "Campagne introuvable" });
        return campaign;
    });
    app.post("/campaigns/:id/run", async (req, reply) => {
        const p = parse(runSchema, req.body ?? {});
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const summary = await (0, pipeline_1.runCampaign)(req.params.id, p.data);
            return summary;
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    app.post("/campaigns/:id/pause", async (req, reply) => {
        const campaign = await db_1.prisma.campaign.update({
            where: { id: req.params.id },
            data: { status: "paused" },
        });
        return campaign;
    });
    // Mini-éditeur de campagne (ton, nom, objectif, budget)
    app.patch("/campaigns/:id", async (req, reply) => {
        const p = parse(campaignPatchSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        const campaign = await db_1.prisma.campaign.update({
            where: { id: req.params.id },
            data: {
                ...(p.data.name !== undefined ? { name: p.data.name } : {}),
                ...(p.data.objective !== undefined ? { objective: p.data.objective } : {}),
                ...(p.data.tone !== undefined ? { tone: p.data.tone } : {}),
                ...(p.data.budget !== undefined ? { budget: p.data.budget } : {}),
                ...(p.data.status !== undefined ? { status: p.data.status } : {}),
            },
        });
        return campaign;
    });
    // ─── Génération de contenu ──────────────────────────────────
    // Tons éditoriaux disponibles
    app.get("/content/tones", async () => tones_1.TONE_PRESETS);
    app.post("/content/text", async (req, reply) => {
        const p = parse(textSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        const text = await (0, textGenerator_1.generatePostText)(p.data);
        return { text };
    });
    app.post("/content/script", async (req, reply) => {
        const p = parse(scriptSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        return (0, textGenerator_1.generateVideoScript)(p.data);
    });
    app.post("/content/image", async (req, reply) => {
        const p = parse(imageSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            return await (0, imageGenerator_1.generateImage)(p.data);
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    app.post("/content/video", async (req, reply) => {
        const p = parse(videoSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const script = await (0, textGenerator_1.generateVideoScript)({
                topic: p.data.topic,
                durationSec: p.data.durationSec,
            });
            const images = (p.data.images ?? []).map(files_1.resolveMediaPath);
            const video = await (0, videoGenerator_1.generateCampaignVideo)({
                script,
                images,
                withVoice: p.data.withVoice,
                mode: p.data.mode,
            });
            return video;
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    app.post("/content/email", async (req, reply) => {
        const p = parse(emailContentSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        return (0, textGenerator_1.generateEmailContent)(p.data);
    });
    // ─── Médiathèque ────────────────────────────────────────────
    app.get("/media", async (req) => {
        const { category, q } = req.query;
        const where = {};
        if (category)
            where.category = category;
        if (q) {
            where.OR = [{ caption: { contains: q } }, { tags: { contains: q } }, { category: { contains: q } }];
        }
        return db_1.prisma.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 });
    });
    // Catégories présentes dans la médiathèque (avec compteurs)
    app.get("/media/categories", async () => {
        const assets = await db_1.prisma.mediaAsset.findMany({ select: { category: true } });
        const counts = {};
        for (const a of assets) {
            const c = a.category ?? "non-categorie";
            counts[c] = (counts[c] ?? 0) + 1;
        }
        return Object.entries(counts).map(([category, count]) => ({ category, count }));
    });
    app.post("/media/upload", async (req, reply) => {
        // Parcours explicite des parties multipart (champs + fichier),
        // indépendant du comportement d'attachement des champs du plugin.
        let file = null;
        let buf = null;
        const fields = {};
        for await (const part of req.parts()) {
            if (part.type === "file") {
                file = part;
                buf = await part.toBuffer();
            }
            else {
                fields[part.fieldname] = String(part.value ?? "");
            }
        }
        if (!file || !buf)
            return reply.code(400).send({ error: "Aucun fichier reçu" });
        const category = fields.category || null;
        const caption = fields.caption || null;
        const tags = fields.tags || null;
        const ext = (0, node_path_1.extname)(file.filename) || ".bin";
        const name = `upload-${Date.now()}${ext}`;
        const type = file.mimetype.startsWith("video") ? "video" : "image";
        const dir = type === "video" ? "videos" : "images";
        const relPath = await (0, files_1.saveBuffer)(buf, `assets/${dir}/${name}`);
        const asset = await db_1.prisma.mediaAsset.create({
            data: {
                type,
                url: `/${relPath.replace(/\\/g, "/")}`,
                localPath: relPath,
                category,
                caption,
                tags,
            },
        });
        return reply.code(201).send(asset);
    });
    // Modifier les métadonnées d'un média (catégorie, légende, tags)
    app.patch("/media/:id", async (req, reply) => {
        const p = parse(mediaPatchSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        const asset = await db_1.prisma.mediaAsset.update({
            where: { id: req.params.id },
            data: {
                ...(p.data.category !== undefined ? { category: p.data.category } : {}),
                ...(p.data.caption !== undefined ? { caption: p.data.caption } : {}),
                ...(p.data.tags !== undefined ? { tags: p.data.tags } : {}),
            },
        });
        return asset;
    });
    // Collecter les médias (images/vidéos) d'un site web dans la médiathèque
    app.post("/media/collect", async (req, reply) => {
        const p = parse(collectSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const result = await (0, mediaCollector_1.collectMediaFromSite)(p.data);
            return result;
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // Importer un média unique depuis une URL
    app.post("/media/fetch", async (req, reply) => {
        const p = parse(fetchMediaSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const asset = await (0, mediaCollector_1.fetchMediaFromUrl)(p.data);
            return reply.code(201).send(asset);
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    app.delete("/media/:id", async (req, reply) => {
        await db_1.prisma.mediaAsset.delete({ where: { id: req.params.id } });
        return { deleted: true };
    });
    // ─── Calendrier éditorial ───────────────────────────────────
    app.get("/calendar", async () => (0, calendar_1.getCalendar)());
    app.post("/calendar", async (req, reply) => {
        const p = parse(calendarSlotSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const slot = await (0, calendar_1.upsertSlot)(p.data);
            return reply.code(201).send(slot);
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    app.delete("/calendar/:id", async (req, reply) => {
        await (0, calendar_1.deleteSlot)(req.params.id);
        return { deleted: true };
    });
    // Génère les posts planifiés des N prochains jours à partir du calendrier
    app.post("/calendar/generate", async (req, reply) => {
        const p = parse(calendarGenerateSchema, req.body ?? {});
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const result = await (0, calendar_1.generateFromCalendar)(p.data.days ?? 7);
            return result;
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // ─── Posts ──────────────────────────────────────────────────
    app.post("/posts", async (req, reply) => {
        const p = parse(postSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        const { campaignId, platform, topic, mediaId, type } = p.data;
        let text = p.data.text;
        if (!text && topic) {
            text = await (0, textGenerator_1.generatePostText)({ platform, topic });
        }
        if (!text)
            return reply.code(400).send({ error: "text ou topic requis" });
        let mediaUrl = null;
        let mediaType = null;
        if (mediaId) {
            const asset = await db_1.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
            if (!asset)
                return reply.code(404).send({ error: "Média introuvable" });
            mediaUrl = asset.url;
            mediaType = asset.type;
        }
        const post = await db_1.prisma.post.create({
            data: {
                campaignId: campaignId ?? null,
                platform,
                type,
                text,
                mediaUrl,
                mediaType,
            },
        });
        return reply.code(201).send(post);
    });
    app.get("/posts", async (req) => {
        const { status, platform } = req.query;
        return db_1.prisma.post.findMany({
            where: { status, platform },
            orderBy: { createdAt: "desc" },
            take: 100,
        });
    });
    app.post("/posts/:id/publish", async (req, reply) => {
        const p = parse(publishSchema, req.body ?? {});
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            return await (0, pipeline_1.publishPostRecord)(req.params.id, { force: p.data.force });
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // Éditer le texte d'un brouillon
    app.patch("/posts/:id", async (req, reply) => {
        const p = parse(postPatchSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        return db_1.prisma.post.update({
            where: { id: req.params.id },
            data: { text: p.data.text, status: "draft" },
        });
    });
    // Relecture IA d'un brouillon (applique les corrections par défaut)
    app.post("/posts/:id/review", async (req, reply) => {
        const p = parse(reviewSchema, req.body ?? {});
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        const post = await db_1.prisma.post.findUnique({ where: { id: req.params.id } });
        if (!post)
            return reply.code(404).send({ error: "Post introuvable" });
        try {
            const review = await (0, reviewer_1.reviewPostText)({ platform: post.platform, text: post.text });
            if (p.data.apply && review.correctedText) {
                await db_1.prisma.post.update({ where: { id: post.id }, data: { text: review.correctedText } });
            }
            await db_1.prisma.post.update({
                where: { id: post.id },
                data: {
                    reviewScore: review.score,
                    reviewIssues: JSON.stringify(review.issues),
                    status: review.verdict === "needs_work" ? "needs_review" : post.status,
                },
            });
            return review;
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    app.post("/posts/:id/schedule", async (req, reply) => {
        const p = parse(scheduleSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        const scheduledAt = new Date(p.data.scheduledAt);
        if (Number.isNaN(scheduledAt.getTime())) {
            return reply.code(400).send({ error: "Date de planification invalide" });
        }
        return db_1.prisma.post.update({
            where: { id: req.params.id },
            data: { status: "scheduled", scheduledAt },
        });
    });
    app.post("/posts/run-scheduled", async () => {
        const published = await (0, pipeline_1.publishScheduledPosts)();
        return { published };
    });
    app.delete("/posts/:id", async (req) => {
        await db_1.prisma.post.delete({ where: { id: req.params.id } });
        return { deleted: true };
    });
    // ─── Publicités ─────────────────────────────────────────────
    app.post("/ads/meta", async (req, reply) => {
        const p = parse(adSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const copy = await (0, textGenerator_1.generateAdCopy)({ objective: p.data.objective ?? "awareness", offer: p.data.name });
            const mc = await metaAds.createCampaign({
                name: p.data.name,
                objective: p.data.objective,
                dailyBudget: p.data.budget,
            });
            const adset = await metaAds.createAdSet({
                campaignId: mc.id,
                name: `${p.data.name} — Ad Set`,
                dailyBudget: p.data.budget,
                targeting: p.data.targeting,
            });
            const creative = await metaAds.createAdCreative({
                name: `${p.data.name} — Créatif`,
                message: copy.primaryText,
            });
            const ad = await metaAds.createAd({
                name: p.data.name,
                adsetId: adset.id,
                creativeId: creative.id,
            });
            const record = await db_1.prisma.ad.create({
                data: {
                    campaignId: p.data.campaignId ?? null,
                    platform: "meta",
                    name: p.data.name,
                    budget: p.data.budget ?? null,
                    targeting: p.data.targeting ? JSON.stringify(p.data.targeting) : null,
                    externalId: ad.id,
                    creativeId: creative.id,
                    status: "paused",
                },
            });
            return reply.code(201).send(record);
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    app.post("/ads/tiktok", async (req, reply) => {
        const p = parse(adSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        if (!p.data.budget)
            return reply.code(400).send({ error: "budget requis pour TikTok Ads" });
        try {
            const tc = await tiktokAds.createCampaign({ name: p.data.name, budget: p.data.budget });
            const ag = await tiktokAds.createAdGroup({
                campaignId: tc.id,
                name: `${p.data.name} — Ad Group`,
                budget: p.data.budget,
            });
            const ta = await tiktokAds.createAd({ adGroupId: ag.id, name: p.data.name });
            const record = await db_1.prisma.ad.create({
                data: {
                    campaignId: p.data.campaignId ?? null,
                    platform: "tiktok",
                    name: p.data.name,
                    budget: p.data.budget,
                    targeting: p.data.targeting ? JSON.stringify(p.data.targeting) : null,
                    externalId: ta.id,
                    status: "paused",
                },
            });
            return reply.code(201).send(record);
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    app.get("/ads", async () => db_1.prisma.ad.findMany({ orderBy: { createdAt: "desc" } }));
    app.post("/ads/:id/pause", async (req, reply) => {
        const ad = await db_1.prisma.ad.findUnique({ where: { id: req.params.id } });
        if (!ad)
            return reply.code(404).send({ error: "Annonce introuvable" });
        if (ad.platform === "meta" && ad.externalId && !config_1.config.demoMode) {
            await metaAds.updateCampaignStatus(ad.externalId, "PAUSED").catch((err) => console.error("[ads] Pause Meta impossible :", err));
        }
        return db_1.prisma.ad.update({ where: { id: ad.id }, data: { status: "paused" } });
    });
    // ─── Leads (capture publique) ───────────────────────────────
    app.post("/leads", async (req, reply) => {
        const p = parse(leadSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const { lead, isNew } = await (0, leadCapture_1.captureLead)(p.data);
            return reply.code(isNew ? 201 : 200).send({ lead, isNew });
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    app.get("/leads", async (req) => {
        const { status } = req.query;
        return db_1.prisma.lead.findMany({
            where: { status },
            include: {
                campaign: { select: { name: true } },
                _count: { select: { messages: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 200,
        });
    });
    app.post("/leads/:id/convert", async (req, reply) => {
        const p = parse(bookingSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const booking = await (0, leadCapture_1.convertToBooking)(req.params.id, p.data);
            return reply.code(201).send(booking);
        }
        catch (err) {
            return reply.code(400).send({ error: err.message });
        }
    });
    // Envoyer le message de nurturing de l'étape choisie sur un canal donné
    app.post("/leads/:id/message", async (req, reply) => {
        const p = parse(messageSchema, req.body ?? {});
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        const lead = await db_1.prisma.lead.findUnique({ where: { id: req.params.id } });
        if (!lead)
            return reply.code(404).send({ error: "Lead introuvable" });
        const result = await (0, messaging_1.sendNurtureMessage)(lead, p.data.stage, p.data.channel);
        if (!result.sent) {
            return reply.code(400).send({
                error: "Aucun canal disponible pour ce lead. Vérifiez email/phone/PSID et la configuration.",
            });
        }
        return result;
    });
    app.post("/leads/nurture", async () => (0, leadCapture_1.nurtureLeads)());
    // ─── Messaging (WhatsApp + Messenger) ───────────────────────
    app.get("/messaging/messenger-link/:campaignId", async (req, reply) => {
        const campaign = await db_1.prisma.campaign.findUnique({ where: { id: req.params.campaignId } });
        if (!campaign)
            return reply.code(404).send({ error: "Campagne introuvable" });
        return { url: (0, messenger_1.buildRefUrl)(campaign.id) };
    });
    app.post("/messaging/otn", async (req, reply) => {
        const p = parse(otnSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            return await (0, messenger_1.requestOneTimeNotification)(p.data);
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // Webhook Meta (public) : vérification GET + événements POST
    app.get("/messaging/webhook", async (req, reply) => {
        const q = req.query;
        const token = config_1.config.webhook.verifyToken || config_1.config.messenger.verifyToken;
        if (!token) {
            return reply.code(400).send({ error: "WEBHOOK_VERIFY_TOKEN non configuré" });
        }
        if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === token) {
            return reply.type("text/plain").send(q["hub.challenge"] ?? "");
        }
        return reply.code(403).send({ error: "Vérification du webhook échouée" });
    });
    app.post("/messaging/webhook", async (req, reply) => {
        try {
            const stats = await (0, webhooks_1.handleWebhookEvent)(req.body);
            return { received: true, ...stats };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // ─── Intégrations (connexion Facebook / TikTok) ──────────────
    app.get("/integrations/status", async () => (0, status_1.getIntegrationStatus)());
    // Facebook : user token → token longue durée → page token → .env (option)
    app.post("/integrations/facebook/connect", async (req, reply) => {
        const p = parse(facebookConnectSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const longLived = await (0, facebook_1.exchangeLongLivedToken)(p.data.userToken);
            const pages = await (0, facebook_1.listPages)(longLived);
            const page = pages.find((pg) => pg.id === p.data.pageId) ?? (pages.length === 1 ? pages[0] : undefined);
            if (!page) {
                return reply.code(200).send({
                    step: "select_page",
                    message: "Plusieurs pages disponibles : renvoyez la requête avec le pageId choisi.",
                    pages: pages.map((pg) => ({ id: pg.id, name: pg.name })),
                });
            }
            const valid = await (0, facebook_1.validatePageToken)(page.access_token);
            if (p.data.persist) {
                await (0, persist_1.setEnvValue)("FB_PAGE_TOKEN", page.access_token);
                await (0, persist_1.setEnvValue)("FB_PAGE_ID", page.id);
            }
            return {
                connected: true,
                page: { id: page.id, name: valid.name },
                persisted: p.data.persist,
                restartRequired: p.data.persist,
            };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // TikTok : générer l'URL d'autorisation OAuth
    app.get("/integrations/tiktok/auth-url", async (req, reply) => {
        const q = req.query;
        const p = parse(tiktokAuthUrlSchema, { redirectUri: q.redirectUri });
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const url = (0, tiktok_1.buildAuthUrl)(p.data.redirectUri, ["user.info.basic", "video.publish"]);
            return { url };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // TikTok : échanger le code OAuth → token → .env (option)
    app.post("/integrations/tiktok/connect", async (req, reply) => {
        const p = parse(tiktokConnectSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        try {
            const token = await (0, tiktok_1.getAccessToken)(p.data.code, p.data.redirectUri);
            const user = await (0, tiktok_1.getUserInfo)(token);
            if (p.data.persist) {
                await (0, persist_1.setEnvValue)("TIKTOK_ACCESS_TOKEN", token);
            }
            return {
                connected: true,
                user,
                persisted: p.data.persist,
                restartRequired: p.data.persist,
            };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });
    // ─── Réservations ───────────────────────────────────────────
    app.get("/bookings", async () => db_1.prisma.booking.findMany({
        include: { lead: { select: { name: true, email: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        take: 200,
    }));
    // ─── Tracking ───────────────────────────────────────────────
    app.post("/track", async (req, reply) => {
        const p = parse(trackSchema, req.body);
        if (!p.ok)
            return reply.code(400).send({ error: p.error });
        await db_1.prisma.performance.create({
            data: {
                entityType: "landing",
                entityId: p.data.campaignId ?? "direct",
                platform: "inbound",
                metric: p.data.event,
                value: 1,
            },
        });
        return reply.code(204).send();
    });
}
//# sourceMappingURL=admin.js.map