import type { FastifyInstance } from "fastify";
import { extname } from "node:path";
import { z } from "zod";
import { config } from "../config";
import { prisma } from "../db";
import {
  generateAdCopy,
  generateEmailContent,
  generatePostText,
  generateVideoScript,
} from "../content/textGenerator";
import { generateImage } from "../content/imageGenerator";
import { collectMediaFromSite, fetchMediaFromUrl } from "../content/mediaCollector";
import { generateCampaignVideo } from "../content/videoGenerator";
import {
  publishPostRecord,
  publishScheduledPosts,
  runCampaign,
} from "../pipeline";
import {
  captureLead,
  convertToBooking,
  nurtureLeads,
} from "../inbound/leadCapture";
import { sendNurtureMessage } from "../inbound/messaging";
import { handleWebhookEvent } from "../messaging/webhooks";
import { buildRefUrl, requestOneTimeNotification } from "../messaging/messenger";
import {
  buildAuthUrl as buildTiktokAuthUrl,
  getAccessToken as getTiktokAccessToken,
  getUserInfo as getTiktokUserInfo,
} from "../social/tiktok";
import {
  exchangeLongLivedToken,
  listPages,
  validatePageToken,
} from "../social/facebook";
import { getIntegrationStatus } from "../integrations/status";
import { setEnvValue } from "../integrations/persist";
import { saveBuffer, resolveMediaPath } from "../lib/files";
import { TONE_PRESETS } from "../content/tones";
import { reviewPostText } from "../content/reviewer";
import { deleteSlot,
  generateFromCalendar,
  getCalendar,
  upsertSlot,
} from "../content/calendar";
import * as metaAds from "../ads/metaAds";
import * as tiktokAds from "../ads/tiktokAds";

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, body: unknown) {
  const r = schema.safeParse(body);
  if (!r.success) {
    return {
      ok: false as const,
      error: r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
    };
  }
  return { ok: true as const, data: r.data };
}

// ─── Schémas ──────────────────────────────────────────────────

const campaignSchema = z.object({
  name: z.string().min(2),
  platform: z.string().default("multi"),
  objective: z.string().default("awareness"),
  tone: z.string().optional(),
  budget: z.number().int().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  autoRun: z.boolean().default(false),
});

const campaignPatchSchema = z.object({
  name: z.string().min(2).optional(),
  objective: z.string().optional(),
  tone: z.string().nullable().optional(),
  budget: z.number().int().positive().nullable().optional(),
  status: z.string().optional(),
});

const runSchema = z.object({
  platforms: z.array(z.enum(["facebook", "tiktok"])).optional(),
  publishNow: z.boolean().default(false),
  withVideo: z.boolean().default(false),
  withAds: z.boolean().default(false),
});

const textSchema = z.object({
  platform: z.string().min(1),
  topic: z.string().min(1),
  tone: z.string().optional(),
});

const scriptSchema = z.object({
  topic: z.string().min(1),
  durationSec: z.number().int().positive().optional(),
});

const imageSchema = z.object({
  prompt: z.string().min(1),
  provider: z.enum(["auto", "openai", "stability", "replicate", "fal", "huggingface", "together", "getimg", "local"]).optional(),
  size: z.string().optional(),
});

const videoSchema = z.object({
  topic: z.string().min(1),
  images: z.array(z.string()).optional(),
  durationSec: z.number().int().positive().optional(),
  withVoice: z.boolean().optional(),
  mode: z.enum(["auto", "ffmpeg", "ai", "replicate", "fal"]).optional(),
});

const emailContentSchema = z.object({
  stage: z.enum(["welcome", "followup1", "followup2", "offer"]),
  leadName: z.string().optional(),
  offer: z.string().optional(),
});

const collectSchema = z.object({
  url: z.string().url(),
  max: z.number().int().min(1).max(50).optional(),
});

const fetchMediaSchema = z.object({
  url: z.string().url(),
  category: z.string().optional(),
  caption: z.string().optional(),
  tags: z.string().optional(),
});

const mediaPatchSchema = z.object({
  category: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
});

const calendarSlotSchema = z.object({
  id: z.string().optional(),
  platform: z.enum(["facebook", "tiktok"]),
  dayOfWeek: z.number().int().min(1).max(7),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  type: z.enum(["text", "photo", "video"]),
  topic: z.string().min(2),
  tone: z.string().optional(),
  enabled: z.boolean().optional(),
});

const calendarGenerateSchema = z.object({
  days: z.number().int().min(1).max(14).optional(),
});

const postSchema = z.object({
  campaignId: z.string().optional(),
  platform: z.string().min(1),
  text: z.string().optional(),
  topic: z.string().optional(),
  mediaId: z.string().optional(),
  type: z.string().default("text"),
});

const scheduleSchema = z.object({ scheduledAt: z.string().min(1) });

const postPatchSchema = z.object({
  text: z.string().min(1).optional(),
});

const publishSchema = z.object({
  force: z.boolean().default(false),
});

const reviewSchema = z.object({
  apply: z.boolean().default(true),
});

const adSchema = z.object({
  campaignId: z.string().optional(),
  name: z.string().min(1),
  objective: z.string().optional(),
  budget: z.number().int().positive().optional(),
  targeting: z.record(z.unknown()).optional(),
});

const leadSchema = z
  .object({
    campaignId: z.string().optional(),
    source: z.string().default("landing_page"),
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    consent: z.boolean().default(true),
  })
  .refine((d) => d.email || d.phone, { message: "email ou phone requis" });

const bookingSchema = z.object({
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  guests: z.number().int().positive().optional(),
  roomType: z.string().optional(),
  amount: z.number().int().positive().optional(),
});

const trackSchema = z.object({
  campaignId: z.string().optional(),
  event: z.string().default("pageview"),
  utm_source: z.string().optional(),
});

const messageSchema = z.object({
  channel: z.enum(["email", "whatsapp", "messenger"]).optional(),
  stage: z.number().int().min(0).max(3).default(1),
});

const otnSchema = z.object({
  psid: z.string().min(1),
  title: z.string().min(1),
  payload: z.string().min(1),
});

const facebookConnectSchema = z.object({
  userToken: z.string().min(20),
  pageId: z.string().optional(),
  persist: z.boolean().default(false),
});

const tiktokAuthUrlSchema = z.object({ redirectUri: z.string().min(1) });

const tiktokConnectSchema = z.object({
  code: z.string().min(1),
  redirectUri: z.string().min(1),
  persist: z.boolean().default(false),
});

export async function adminRoutes(app: FastifyInstance) {
  // ─── Santé ──────────────────────────────────────────────────
  app.get("/health", async () => ({
    ok: true,
    service: "hotel-marketing-agent",
    demoMode: config.demoMode,
  }));

  // ─── Dashboard ──────────────────────────────────────────────
  app.get("/dashboard", async () => {
    const [campaigns, posts, ads, totalLeads, newLeads, bookedLeads, bookings, revenue, spend, messages] =
      await Promise.all([
        prisma.campaign.count(),
        prisma.post.count(),
        prisma.ad.count(),
        prisma.lead.count(),
        prisma.lead.count({ where: { status: "new" } }),
        prisma.lead.count({ where: { status: "booked" } }),
        prisma.booking.count(),
        prisma.booking.aggregate({ _sum: { amount: true } }),
        prisma.performance.aggregate({ _sum: { value: true }, where: { metric: "spend" } }),
        prisma.messageLog.count(),
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
    if (!p.ok) return reply.code(400).send({ error: p.error });
    const { name, platform, objective, tone, budget, startDate, endDate, autoRun } = p.data;
    const campaign = await prisma.campaign.create({
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
        await runCampaign(campaign.id, {});
      } catch (err) {
        return reply.code(201).send({ campaign, warning: (err as Error).message });
      }
    }
    return reply.code(201).send(campaign);
  });

  app.get("/campaigns", async () =>
    prisma.campaign.findMany({
      include: { _count: { select: { posts: true, leads: true, bookings: true } } },
      orderBy: { createdAt: "desc" },
    }),
  );

  app.get<{ Params: { id: string } }>("/campaigns/:id", async (req, reply) => {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: { posts: true, ads: true, leads: true, bookings: true },
    });
    if (!campaign) return reply.code(404).send({ error: "Campagne introuvable" });
    return campaign;
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/run", async (req, reply) => {
    const p = parse(runSchema, req.body ?? {});
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const summary = await runCampaign(req.params.id, p.data);
      return summary;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/pause", async (req, reply) => {
    const campaign = await prisma.campaign.update({
      where: { id: req.params.id },
      data: { status: "paused" },
    });
    return campaign;
  });

  // Mini-éditeur de campagne (ton, nom, objectif, budget)
  app.patch<{ Params: { id: string } }>("/campaigns/:id", async (req, reply) => {
    const p = parse(campaignPatchSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    const campaign = await prisma.campaign.update({
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

  // ─── Webhooks (Meta & TikTok) ──────────────────────────────
  // Canonique : Meta valide ici le verify token puis envoie les événements.
  app.get("/webhooks/meta", async (req, reply) => {
    const q = req.query as { "hub.mode"?: string; "hub.verify_token"?: string; "hub.challenge"?: string };
    const token = config.webhook.verifyToken;
    if (!token) {
      return reply.code(400).send({ error: "WEBHOOK_VERIFY_TOKEN non configuré" });
    }
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === token) {
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    }
    return reply.code(403).send({ error: "Vérification du webhook échouée" });
  });

  app.post("/webhooks/meta", async (req, reply) => {
    try {
      const stats = await handleWebhookEvent(req.body);
      return { received: true, ...stats };
    } catch (err) {
      console.error("[webhook meta] Erreur de traitement :", err);
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.get("/webhooks/tiktok", async (_req, reply) => {
    // TikTok valide l'endpoint via un challenge signé (HMAC) — implémenté lors
    // de la connexion réelle de TikTok Business.
    return reply.code(200).send("OK");
  });

  app.post("/webhooks/tiktok", async (req, reply) => {
    console.log("[webhook] Événement TikTok reçu :", JSON.stringify(req.body).slice(0, 500));
    return reply.code(200).send("EVENT_RECEIVED");
  });

  // ─── Génération de contenu ──────────────────────────────────
  // Tons éditoriaux disponibles
  app.get("/content/tones", async () => TONE_PRESETS);
  app.post("/content/text", async (req, reply) => {
    const p = parse(textSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    const text = await generatePostText(p.data);
    return { text };
  });

  app.post("/content/script", async (req, reply) => {
    const p = parse(scriptSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    return generateVideoScript(p.data);
  });

  app.post("/content/image", async (req, reply) => {
    const p = parse(imageSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      return await generateImage(p.data);
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post("/content/video", async (req, reply) => {
    const p = parse(videoSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const script = await generateVideoScript({
        topic: p.data.topic,
        durationSec: p.data.durationSec,
      });
      const images = (p.data.images ?? []).map(resolveMediaPath);
      const video = await generateCampaignVideo({
        script,
        images,
        withVoice: p.data.withVoice,
        mode: p.data.mode,
      });
      return video;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post("/content/email", async (req, reply) => {
    const p = parse(emailContentSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    return generateEmailContent(p.data);
  });

  // ─── Médiathèque ────────────────────────────────────────────
  app.get("/media", async (req) => {
    const { category, q } = req.query as { category?: string; q?: string };
    const where: any = {};
    if (category) where.category = category;
    if (q) {
      where.OR = [{ caption: { contains: q } }, { tags: { contains: q } }, { category: { contains: q } }];
    }
    return prisma.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 });
  });

  // Catégories présentes dans la médiathèque (avec compteurs)
  app.get("/media/categories", async () => {
    const assets = await prisma.mediaAsset.findMany({ select: { category: true } });
    const counts: Record<string, number> = {};
    for (const a of assets) {
      const c = a.category ?? "non-categorie";
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return Object.entries(counts).map(([category, count]) => ({ category, count }));
  });

  app.post("/media/upload", async (req, reply) => {
    // Parcours explicite des parties multipart (champs + fichier),
    // indépendant du comportement d'attachement des champs du plugin.
    let file: any = null;
    let buf: Buffer | null = null;
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === "file") {
        file = part;
        buf = await part.toBuffer();
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }
    if (!file || !buf) return reply.code(400).send({ error: "Aucun fichier reçu" });

    const category = fields.category || null;
    const caption = fields.caption || null;
    const tags = fields.tags || null;
    const ext = extname(file.filename) || ".bin";
    const name = `upload-${Date.now()}${ext}`;
    const type = file.mimetype.startsWith("video") ? "video" : "image";
    const dir = type === "video" ? "videos" : "images";
    const relPath = await saveBuffer(buf, `assets/${dir}/${name}`);
    const asset = await prisma.mediaAsset.create({
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
  app.patch<{ Params: { id: string } }>("/media/:id", async (req, reply) => {
    const p = parse(mediaPatchSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    const asset = await prisma.mediaAsset.update({
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
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const result = await collectMediaFromSite(p.data);
      return result;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // Importer un média unique depuis une URL
  app.post("/media/fetch", async (req, reply) => {
    const p = parse(fetchMediaSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const asset = await fetchMediaFromUrl(p.data);
      return reply.code(201).send(asset);
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>("/media/:id", async (req, reply) => {
    await prisma.mediaAsset.delete({ where: { id: req.params.id } });
    return { deleted: true };
  });

  // ─── Calendrier éditorial ───────────────────────────────────
  app.get("/calendar", async () => getCalendar());

  app.post("/calendar", async (req, reply) => {
    const p = parse(calendarSlotSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const slot = await upsertSlot(p.data);
      return reply.code(201).send(slot);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete<{ Params: { id: string } }>("/calendar/:id", async (req, reply) => {
    await deleteSlot(req.params.id);
    return { deleted: true };
  });

  // Génère les posts planifiés des N prochains jours à partir du calendrier
  app.post("/calendar/generate", async (req, reply) => {
    const p = parse(calendarGenerateSchema, req.body ?? {});
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const result = await generateFromCalendar(p.data.days ?? 7);
      return result;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // ─── Posts ──────────────────────────────────────────────────
  app.post("/posts", async (req, reply) => {
    const p = parse(postSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    const { campaignId, platform, topic, mediaId, type } = p.data;

    let text = p.data.text;
    if (!text && topic) {
      text = await generatePostText({ platform, topic });
    }
    if (!text) return reply.code(400).send({ error: "text ou topic requis" });

    let mediaUrl: string | null = null;
    let mediaType: string | null = null;
    if (mediaId) {
      const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
      if (!asset) return reply.code(404).send({ error: "Média introuvable" });
      mediaUrl = asset.url;
      mediaType = asset.type;
    }

    const post = await prisma.post.create({
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
    const { status, platform } = req.query as { status?: string; platform?: string };
    return prisma.post.findMany({
      where: { status, platform },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });

  app.post<{ Params: { id: string } }>("/posts/:id/publish", async (req, reply) => {
    const p = parse(publishSchema, req.body ?? {});
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      return await publishPostRecord(req.params.id, { force: p.data.force });
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // Éditer le texte d'un brouillon
  app.patch<{ Params: { id: string } }>("/posts/:id", async (req, reply) => {
    const p = parse(postPatchSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    return prisma.post.update({
      where: { id: req.params.id },
      data: { text: p.data.text, status: "draft" },
    });
  });

  // Relecture IA d'un brouillon (applique les corrections par défaut)
  app.post<{ Params: { id: string } }>("/posts/:id/review", async (req, reply) => {
    const p = parse(reviewSchema, req.body ?? {});
    if (!p.ok) return reply.code(400).send({ error: p.error });
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) return reply.code(404).send({ error: "Post introuvable" });
    try {
      const review = await reviewPostText({ platform: post.platform, text: post.text });
      if (p.data.apply && review.correctedText) {
        await prisma.post.update({ where: { id: post.id }, data: { text: review.correctedText } });
      }
      await prisma.post.update({
        where: { id: post.id },
        data: {
          reviewScore: review.score,
          reviewIssues: JSON.stringify(review.issues),
          status: review.verdict === "needs_work" ? "needs_review" : post.status,
        },
      });
      return review;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>("/posts/:id/schedule", async (req, reply) => {
    const p = parse(scheduleSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    const scheduledAt = new Date(p.data.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return reply.code(400).send({ error: "Date de planification invalide" });
    }
    return prisma.post.update({
      where: { id: req.params.id },
      data: { status: "scheduled", scheduledAt },
    });
  });

  app.post("/posts/run-scheduled", async () => {
    const published = await publishScheduledPosts();
    return { published };
  });

  app.delete<{ Params: { id: string } }>("/posts/:id", async (req) => {
    await prisma.post.delete({ where: { id: req.params.id } });
    return { deleted: true };
  });

  // ─── Publicités ─────────────────────────────────────────────
  app.post("/ads/meta", async (req, reply) => {
    const p = parse(adSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const copy = await generateAdCopy({ objective: p.data.objective ?? "awareness", offer: p.data.name });
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
      const record = await prisma.ad.create({
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
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post("/ads/tiktok", async (req, reply) => {
    const p = parse(adSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    if (!p.data.budget) return reply.code(400).send({ error: "budget requis pour TikTok Ads" });
    try {
      const tc = await tiktokAds.createCampaign({ name: p.data.name, budget: p.data.budget });
      const ag = await tiktokAds.createAdGroup({
        campaignId: tc.id,
        name: `${p.data.name} — Ad Group`,
        budget: p.data.budget,
      });
      const ta = await tiktokAds.createAd({ adGroupId: ag.id, name: p.data.name });
      const record = await prisma.ad.create({
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
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.get("/ads", async () => prisma.ad.findMany({ orderBy: { createdAt: "desc" } }));

  app.post<{ Params: { id: string } }>("/ads/:id/pause", async (req, reply) => {
    const ad = await prisma.ad.findUnique({ where: { id: req.params.id } });
    if (!ad) return reply.code(404).send({ error: "Annonce introuvable" });
    if (ad.platform === "meta" && ad.externalId && !config.demoMode) {
      await metaAds.updateCampaignStatus(ad.externalId, "PAUSED").catch((err) =>
        console.error("[ads] Pause Meta impossible :", err),
      );
    }
    return prisma.ad.update({ where: { id: ad.id }, data: { status: "paused" } });
  });

  // ─── Leads (capture publique) ───────────────────────────────
  app.post("/leads", async (req, reply) => {
    const p = parse(leadSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const { lead, isNew } = await captureLead(p.data);
      return reply.code(isNew ? 201 : 200).send({ lead, isNew });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.get("/leads", async (req) => {
    const { status } = req.query as { status?: string };
    return prisma.lead.findMany({
      where: { status },
      include: {
        campaign: { select: { name: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });

  app.post<{ Params: { id: string } }>("/leads/:id/convert", async (req, reply) => {
    const p = parse(bookingSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const booking = await convertToBooking(req.params.id, p.data);
      return reply.code(201).send(booking);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // Envoyer le message de nurturing de l'étape choisie sur un canal donné
  app.post<{ Params: { id: string } }>("/leads/:id/message", async (req, reply) => {
    const p = parse(messageSchema, req.body ?? {});
    if (!p.ok) return reply.code(400).send({ error: p.error });
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return reply.code(404).send({ error: "Lead introuvable" });
    const result = await sendNurtureMessage(lead, p.data.stage, p.data.channel);
    if (!result.sent) {
      return reply.code(400).send({
        error: "Aucun canal disponible pour ce lead. Vérifiez email/phone/PSID et la configuration.",
      });
    }
    return result;
  });

  app.post("/leads/nurture", async () => nurtureLeads());

  // ─── Messaging (WhatsApp + Messenger) ───────────────────────
  app.get<{ Params: { campaignId: string } }>("/messaging/messenger-link/:campaignId", async (req, reply) => {
    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.campaignId } });
    if (!campaign) return reply.code(404).send({ error: "Campagne introuvable" });
    return { url: buildRefUrl(campaign.id) };
  });

  app.post("/messaging/otn", async (req, reply) => {
    const p = parse(otnSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      return await requestOneTimeNotification(p.data);
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // Webhook Meta (public) : vérification GET + événements POST
  app.get("/messaging/webhook", async (req, reply) => {
    const q = req.query as { "hub.mode"?: string; "hub.verify_token"?: string; "hub.challenge"?: string };
    const token = config.webhook.verifyToken || config.messenger.verifyToken;
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
      const stats = await handleWebhookEvent(req.body);
      return { received: true, ...stats };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // ─── Intégrations (connexion Facebook / TikTok) ──────────────
  app.get("/integrations/status", async () => getIntegrationStatus());

  // Facebook : user token → token longue durée → page token → .env (option)
  app.post("/integrations/facebook/connect", async (req, reply) => {
    const p = parse(facebookConnectSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const longLived = await exchangeLongLivedToken(p.data.userToken);
      const pages = await listPages(longLived);
      const page =
        pages.find((pg) => pg.id === p.data.pageId) ?? (pages.length === 1 ? pages[0] : undefined);
      if (!page) {
        return reply.code(200).send({
          step: "select_page",
          message: "Plusieurs pages disponibles : renvoyez la requête avec le pageId choisi.",
          pages: pages.map((pg) => ({ id: pg.id, name: pg.name })),
        });
      }
      const valid = await validatePageToken(page.access_token);
      if (p.data.persist) {
        await setEnvValue("FB_PAGE_TOKEN", page.access_token);
        await setEnvValue("FB_PAGE_ID", page.id);
      }
      return {
        connected: true,
        page: { id: page.id, name: valid.name },
        persisted: p.data.persist,
        restartRequired: p.data.persist,
      };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // TikTok : générer l'URL d'autorisation OAuth
  app.get("/integrations/tiktok/auth-url", async (req, reply) => {
    const q = req.query as { redirectUri?: string };
    const p = parse(tiktokAuthUrlSchema, { redirectUri: q.redirectUri });
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const url = buildTiktokAuthUrl(p.data.redirectUri, ["user.info.basic", "video.publish"]);
      return { url };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // TikTok : échanger le code OAuth → token → .env (option)
  app.post("/integrations/tiktok/connect", async (req, reply) => {
    const p = parse(tiktokConnectSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    try {
      const token = await getTiktokAccessToken(p.data.code, p.data.redirectUri);
      const user = await getTiktokUserInfo(token);
      if (p.data.persist) {
        await setEnvValue("TIKTOK_ACCESS_TOKEN", token);
      }
      return {
        connected: true,
        user,
        persisted: p.data.persist,
        restartRequired: p.data.persist,
      };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // ─── Réservations ───────────────────────────────────────────
  app.get("/bookings", async () =>
    prisma.booking.findMany({
      include: { lead: { select: { name: true, email: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  );

  // ─── Tracking ───────────────────────────────────────────────
  app.post("/track", async (req, reply) => {
    const p = parse(trackSchema, req.body);
    if (!p.ok) return reply.code(400).send({ error: p.error });
    await prisma.performance.create({
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
