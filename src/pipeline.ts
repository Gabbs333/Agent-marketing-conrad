import { config } from "./config";
import { prisma } from "./db";
import { generateAdCopy, generatePostText, generateVideoScript } from "./content/textGenerator";
import { buildAiTargeting } from "./ads/targeting";
import { generateImage } from "./content/imageGenerator";
import { generateCampaignVideo } from "./content/videoGenerator";
import { collectMediaFromSite } from "./content/mediaCollector";
import { selectMediaForTopic } from "./content/mediaSelector";
import { reviewPostText } from "./content/reviewer";
import { getPostInsights, publishToFacebook } from "./social/facebook";
import { publishPhoto, uploadAndPublishVideo } from "./social/tiktok";
import * as metaAds from "./ads/metaAds";
import * as tiktokAds from "./ads/tiktokAds";
import { resolveMediaPath } from "./lib/files";
import type { GeneratedImage } from "./types";

/**
 * Pipeline « agent » : orchestration complète d'une campagne.
 *
 *   brief → textes par plateforme → image → (vidéo) →
 *   publication/scheduling → publicités → leads → réservations
 */

export interface RunCampaignOptions {
  platforms?: ("facebook" | "tiktok")[];
  publishNow?: boolean;
  withVideo?: boolean;
  withAds?: boolean;
  /** Médias choisis manuellement depuis la médiathèque (prioritaires). */
  mediaIds?: string[];
}

export interface PipelineSummary {
  campaignId: string;
  posts: { id: string; platform: string; status: string }[];
  media: { id: string; type: string }[];
  ads: { platform: string; id: string }[];
  errors: string[];
}

/** Publie un post (texte, photo ou vidéo) sur sa plateforme et met à jour la base.
 *  Relecture IA automatique du texte avant publication (désactivable via `force`). */
export async function publishPostRecord(
  postId: string,
  opts: { force?: boolean } = {},
): Promise<{ postId: string; externalId: string | null; review?: any }> {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new Error("Post introuvable");

  let review: any = null;
  if (!opts.force && post.status !== "published") {
    review = await reviewPostText({ platform: post.platform, text: post.text });
    const text = review.correctedText ?? post.text;
    await prisma.post.update({
      where: { id: postId },
      data: { text, reviewScore: review.score, reviewIssues: JSON.stringify(review.issues) },
    });
    post.text = text;
    if (review.verdict === "needs_work") {
      await prisma.post.update({ where: { id: postId }, data: { status: "needs_review" } });
      throw new Error(
        `Relecture IA refusée (${review.score}/100) : ${review.issues.map((i: any) => i.message).join(" — ")}`,
      );
    }
  }

  const mediaPath = post.mediaUrl ? resolveMediaPath(post.mediaUrl) : undefined;
  let externalId: string | null = null;

  if (post.platform === "facebook") {
    const r = await publishToFacebook({
      text: post.text,
      mediaPath,
      mediaType: (post.mediaType as "image" | "video" | undefined) ?? undefined,
    });
    externalId = r.id;
  } else if (post.platform === "tiktok") {
    if (!mediaPath) {
      throw new Error("TikTok nécessite un média (photo ou vidéo)");
    }
    if (post.mediaType === "video") {
      const r = await uploadAndPublishVideo({ videoPath: mediaPath, caption: post.text });
      externalId = r.id;
    } else {
      const r = await publishPhoto({ imagePath: mediaPath, caption: post.text });
      externalId = r.id;
    }
  } else {
    throw new Error(`Plateforme inconnue : ${post.platform}`);
  }

  const updated = await prisma.post.update({
    where: { id: postId },
    data: { externalId, status: "published", publishedAt: new Date() },
  });
  return { postId, externalId: updated.externalId, review };
}

/** Exécute le pipeline complet d'une campagne. */
export async function runCampaign(
  campaignId: string,
  opts: RunCampaignOptions = {},
): Promise<PipelineSummary> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("Campagne introuvable");

  const platforms = opts.platforms ?? ["facebook", "tiktok"];
  const topic = campaign.name;
  const summary: PipelineSummary = { campaignId, posts: [], media: [], ads: [], errors: [] };

  // 1. Textes par plateforme (ton propre à la campagne)
  const campaignTone = campaign.tone ?? "chaleureux et incitatif";
  for (const platform of platforms) {
    const text = await generatePostText({ platform, topic, tone: campaignTone });
    const post = await prisma.post.create({
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

  // 2. Médias de campagne : les médias choisis manuellement depuis le
  //    dashboard sont prioritaires ; sinon les images de la médiathèque sont
  //    choisies par pertinence avec le sujet (catégories/tags/légendes),
  //    sinon collecte du site, sinon génération IA.
  let libraryImages: GeneratedImage[];
  if (opts.mediaIds?.length) {
    const chosen = await prisma.mediaAsset.findMany({
      where: { id: { in: opts.mediaIds } },
      orderBy: { createdAt: "desc" },
    });
    // L'ordre du tableau mediaIds prime sur l'ordre de la requête
    const byId = new Map(chosen.map((a) => [a.id, a]));
    libraryImages = opts.mediaIds
      .map((id) => byId.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({
        id: a.id,
        url: a.url,
        localPath: a.localPath ?? "",
        provider: "library",
      }));
    summary.media.push(...chosen.map((a) => ({ id: a.id, type: a.type })));
  } else {
    libraryImages = await selectMediaForTopic(topic, 6);
  }

  if (libraryImages.length === 0 && /^https?:\/\//.test(config.hotel.website)) {
    try {
      const collected = await collectMediaFromSite({ url: config.hotel.website, max: 6 });
      libraryImages = collected.assets.map((a) => ({
        id: a.id,
        url: a.url,
        localPath: a.localPath,
        provider: "library",
      }));
      summary.media.push(...collected.assets.map((a) => ({ id: a.id, type: a.type })));
    } catch (err) {
      summary.errors.push(`Collecte des médias du site : ${(err as Error).message}`);
    }
  }

  let image: GeneratedImage;
  if (libraryImages.length > 0) {
    image = libraryImages[0];
  } else {
    image = await generateImage({
      prompt: `Photo professionnelle de ${config.hotel.name} — ${topic}, lumière dorée, haute qualité`,
      size: "1024x1024",
    });
    libraryImages.push(image);
  }
  summary.media.push({ id: image.id, type: "image" });

  const fbPost = summary.posts.find((p) => p.platform === "facebook");
  if (fbPost) {
    await prisma.post.update({
      where: { id: fbPost.id },
      data: { mediaUrl: image.url, mediaType: "image" },
    });
  }

  // TikTok exige un média : on attache l'image de campagne (remplacée
  // par la vidéo si opts.withVideo).
  const ttPost = summary.posts.find((p) => p.platform === "tiktok");
  if (ttPost) {
    await prisma.post.update({
      where: { id: ttPost.id },
      data: { mediaUrl: image.url, mediaType: "image", type: "photo" },
    });
  }

  // 3. Vidéo TikTok (optionnelle) — assemblée à partir des vraies images
  //    de la médiathèque (jusqu'à 4 scènes distinctes)
  if (opts.withVideo && ttPost) {
    try {
      const script = await generateVideoScript({ topic, durationSec: 15 });
      const images = [...new Set([...libraryImages.map((i) => i.localPath), image.localPath])].slice(0, 4);
      const video = await generateCampaignVideo({
        script,
        images,
      });
      await prisma.post.update({
        where: { id: ttPost.id },
        data: { mediaUrl: video.url, mediaType: "video", type: "video" },
      });
      summary.media.push({ id: video.id, type: "video" });
    } catch (err) {
      summary.errors.push(`Vidéo : ${(err as Error).message}`);
    }
  }

  // 4. Publication
  if (opts.publishNow) {
    for (const p of summary.posts.filter((x) => x.status === "ready")) {
      try {
        await publishPostRecord(p.id);
      } catch (err) {
        summary.errors.push(`Publication ${p.platform} : ${(err as Error).message}`);
      }
    }
  }

  // 5. Publicités (optionnelles, si budget)
  if (opts.withAds && campaign.budget) {
    // Meta Ads
    try {
      const copy = await generateAdCopy({ objective: campaign.objective, offer: topic });
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
        targeting:
          (await buildAiTargeting({
            topic,
            objective: campaign.objective,
          }).catch((err) => {
            summary.errors.push(`Ciblage IA : ${(err as Error).message}`);
            return null;
          })) ?? undefined,
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
      await prisma.ad.create({
        data: {
          campaignId,
          platform: "meta",
          name: `${campaign.name} — Annonce`,
          budget: campaign.budget,
          externalId: ad.id,
          creativeId: creative.id,
          mediaUrl: image.url,
          mediaType: "image",
          status: "paused",
        },
      });
      summary.ads.push({ platform: "meta", id: ad.id });
    } catch (err) {
      summary.errors.push(`Meta Ads : ${(err as Error).message}`);
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
      let videoId: string | undefined;
      const tt = await prisma.post.findFirst({
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
      await prisma.ad.create({
        data: {
          campaignId,
          platform: "tiktok",
          name: `${campaign.name} — Annonce`,
          budget: campaign.budget,
          externalId: ta.id,
          mediaUrl: tt?.mediaUrl ?? null,
          mediaType: tt?.mediaType ?? null,
          status: "paused",
        },
      });
      summary.ads.push({ platform: "tiktok", id: ta.id });
    } catch (err) {
      summary.errors.push(`TikTok Ads : ${(err as Error).message}`);
    }
  }

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "active" } });
  return summary;
}

/** Publie tous les posts planifiés dont l'heure est arrivée. */
export async function publishScheduledPosts(): Promise<number> {
  const due = await prisma.post.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() } },
  });
  let count = 0;
  for (const post of due) {
    try {
      await publishPostRecord(post.id);
      count++;
    } catch (err) {
      console.error(`[scheduler] Publication impossible (${post.id}) :`, err);
    }
  }
  return count;
}

function demoMetrics(): Record<string, number> {
  return {
    post_impressions: 800 + Math.floor(Math.random() * 3000),
    post_engagements: 60 + Math.floor(Math.random() * 400),
    post_clicks: 10 + Math.floor(Math.random() * 120),
  };
}

/** Récupère les performances des posts publiés et les enregistre. */
export async function syncPerformance(): Promise<number> {
  const posts = await prisma.post.findMany({
    where: { status: "published", externalId: { not: null } },
    take: 100,
  });
  let records = 0;
  for (const post of posts) {
    try {
      const metrics =
        post.platform === "facebook" && post.externalId
          ? await getPostInsights(post.externalId)
          : demoMetrics();
      for (const [metric, value] of Object.entries(metrics)) {
        await prisma.performance.create({
          data: { entityType: "post", entityId: post.id, platform: post.platform, metric, value },
        });
        records++;
      }
    } catch (err) {
      console.error(`[performance] Échec pour le post ${post.id} :`, err);
    }
  }
  return records;
}
