import { basename } from "node:path";
import { config } from "../config";
import { fileBlob, resolveMediaPath } from "../lib/files";
import { httpJson } from "../lib/http";

/**
 * Meta Ads (Marketing API) :
 *  - création de campagnes, ad sets, créatifs et annonces ;
 *  - upload d'images pour obtenir un image_hash ;
 *  - ciblage, budgets et statuts.
 */

const GRAPH_URL = "https://graph.facebook.com/v20.0";

export interface MetaCampaignInput {
  name: string;
  objective?: string;
  dailyBudget?: number;
  startDate?: Date;
  endDate?: Date;
  status?: string;
}

export interface MetaAdSetInput {
  campaignId: string;
  name: string;
  dailyBudget?: number;
  targeting?: Record<string, unknown>;
  optimizationGoal?: string;
  billingEvent?: string;
  bidStrategy?: string;
  bidAmount?: number;
}

export interface MetaCreativeInput {
  name: string;
  message: string;
  mediaPath?: string;
  mediaType?: "image" | "video";
  link?: string;
  cta?: string;
}

export function formatAdAccountId(id: string): string {
  const clean = id.trim().replace(/^act_/i, "");
  return `act_${clean}`;
}

function requireAccount(): { token: string; account: string } {
  if (config.demoMode || !config.metaAds.accessToken) {
    throw new Error("META_ACCESS_TOKEN manquant (ou DEMO_MODE=true sans API réelle)");
  }
  if (!config.metaAds.adAccountId) throw new Error("META_AD_ACCOUNT_ID manquant");
  return { token: config.metaAds.accessToken, account: formatAdAccountId(config.metaAds.adAccountId) };
}

export async function createCampaign(input: MetaCampaignInput): Promise<{ id: string }> {
  if (config.demoMode || !config.metaAds.accessToken) {
    console.log(`[metaAds][demo] Campagne simulée : ${input.name}`);
    return { id: `demo_mc_${Date.now()}` };
  }
  const { token, account } = requireAccount();
  const body: Record<string, string> = {
    name: input.name,
    objective: input.objective ?? "OUTCOME_TRAFFIC",
    status: input.status ?? "PAUSED",
  };
  // Les budgets de l'API interne sont en unités entières (€) ;
  // Meta attend des centimes (daily_budget=300 → 3,00 €/jour).
  if (input.dailyBudget) body.daily_budget = String(Math.round(input.dailyBudget * 100));
  else body.is_adset_budget_sharing_enabled = "false";
  if (input.startDate) body.start_time = input.startDate.toISOString();
  if (input.endDate) body.stop_time = input.endDate.toISOString();

  const params = new URLSearchParams(body);
  params.append("special_ad_categories", "[]");
  const data = await httpJson(`${GRAPH_URL}/${account}/campaigns`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: params,
  });
  return { id: String(data.id ?? "") };
}

export async function createAdSet(input: MetaAdSetInput): Promise<{ id: string }> {
  if (config.demoMode || !config.metaAds.accessToken) {
    return { id: `demo_ms_${Date.now()}` };
  }
  const { token, account } = requireAccount();
  const targeting =
    input.targeting ?? {
      geo_locations: { countries: config.adsTargeting.countries },
      age_min: config.adsTargeting.ageMin,
      age_max: config.adsTargeting.ageMax,
    };
  const body: Record<string, string> = {
    name: input.name,
    campaign_id: input.campaignId,
    billing_event: input.billingEvent ?? "IMPRESSIONS",
    optimization_goal: input.optimizationGoal ?? "REACH",
    // Compte avec stratégie d'enchère TARGET_COST par défaut : un bid_amount
    // est obligatoire (LOWEST_COST_WITHOUT_CAP est ignoré par l'API dans ce cas).
    bid_strategy: input.bidStrategy ?? "TARGET_COST",
    bid_amount: String(input.bidAmount ?? 500),
    targeting: JSON.stringify(targeting),
    status: "PAUSED",
  };
  // ⚠️ Pas de daily_budget ici si la campagne porte déjà un budget
  // (Advantage Campaign Budget) : Meta rejette la double définition.
  // S'il est fourni : unités entières (€) → centimes.
  if (input.dailyBudget) body.daily_budget = String(Math.round(input.dailyBudget * 100));

  const data = await httpJson(`${GRAPH_URL}/${account}/adsets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams(body),
  });
  return { id: String(data.id ?? "") };
}

/** Upload d'une image dans le compte publicitaire → image_hash. */
export async function uploadAdImage(filePath: string): Promise<string> {
  if (config.demoMode || !config.metaAds.accessToken) return `demo_hash_${Date.now()}`;
  const { token, account } = requireAccount();
  const path = resolveMediaPath(filePath);
  const form = new FormData();
  form.append("filename", await fileBlob(path), basename(path));
  const data = await httpJson(`${GRAPH_URL}/${account}/adimages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const images = data.images ?? {};
  const hash = images[Object.keys(images)[0]]?.hash;
  if (!hash) throw new Error(`Upload image publicitaire échoué : ${JSON.stringify(data).slice(0, 300)}`);
  return hash;
}

/** Upload d'une vidéo sur la bibliothèque vidéo de la page → video_id pour les créatifs. */
export async function uploadPageVideo(filePath: string): Promise<string> {
  if (config.demoMode || !config.metaAds.accessToken) return `demo_video_${Date.now()}`;
  const pageId = config.facebook.pageId;
  const token = config.facebook.pageToken;
  if (!pageId || !token) throw new Error("FB_PAGE_ID / FB_PAGE_TOKEN manquants pour uploader la vidéo");
  const path = resolveMediaPath(filePath);
  const form = new FormData();
  if (path.startsWith("http")) {
    form.append("file_url", path);
  } else {
    form.append("source", await fileBlob(path), basename(path));
  }
  const data = await httpJson(`${GRAPH_URL}/${pageId}/videos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const id = String(data.id ?? "");
  if (!id) throw new Error(`Upload vidéo page échoué : ${JSON.stringify(data).slice(0, 300)}`);
  return id;
}

export async function createAdCreative(input: MetaCreativeInput): Promise<{ id: string }> {
  if (config.demoMode || !config.metaAds.accessToken) {
    return { id: `demo_cr_${Date.now()}` };
  }
  const { token, account } = requireAccount();
  const pageId = config.facebook.pageId;
  if (!pageId) throw new Error("FB_PAGE_ID manquant pour le créatif publicitaire");

  const linkData: Record<string, unknown> = {
    message: input.message,
    link: input.link ?? config.hotel.website,
    call_to_action: {
      type: "LEARN_MORE",
      value: { link: input.link ?? config.hotel.website },
    },
  };
  if (input.mediaPath) {
    if (input.mediaType === "video") {
      linkData.video_id = await uploadPageVideo(input.mediaPath);
    } else {
      linkData.image_hash = await uploadAdImage(input.mediaPath);
    }
  }

  const body = new URLSearchParams({
    name: input.name,
    object_story_spec: JSON.stringify({ page_id: pageId, link_data: linkData }),
  });
  const data = await httpJson(`${GRAPH_URL}/${account}/adcreatives`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  return { id: String(data.id ?? "") };
}

export async function createAd(input: {
  name: string;
  adsetId: string;
  creativeId: string;
}): Promise<{ id: string }> {
  if (config.demoMode || !config.metaAds.accessToken) {
    return { id: `demo_ad_${Date.now()}` };
  }
  const { token, account } = requireAccount();
  const body = new URLSearchParams({
    name: input.name,
    adset_id: input.adsetId,
    status: "PAUSED",
    creative: JSON.stringify({ creative_id: input.creativeId }),
  });
  const data = await httpJson(`${GRAPH_URL}/${account}/ads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  return { id: String(data.id ?? "") };
}

export async function updateCampaignStatus(campaignId: string, status: "ACTIVE" | "PAUSED"): Promise<void> {
  if (config.demoMode || !config.metaAds.accessToken) {
    console.log(`[metaAds][demo] Campagne ${campaignId} → ${status}`);
    return;
  }
  const { token } = requireAccount();
  await httpJson(`${GRAPH_URL}/${campaignId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams({ status }),
  });
}

export async function listCampaigns(): Promise<unknown[]> {
  if (config.demoMode || !config.metaAds.accessToken) return [];
  const { token, account } = requireAccount();
  const data = await httpJson(
    `${GRAPH_URL}/${account}/campaigns?fields=id,name,status,objective,daily_budget`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return data?.data ?? [];
}
