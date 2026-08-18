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
}

export interface MetaCreativeInput {
  name: string;
  message: string;
  mediaPath?: string;
  mediaType?: "image" | "video";
  link?: string;
  cta?: string;
}

function requireAccount(): { token: string; account: string } {
  if (config.demoMode || !config.metaAds.accessToken) {
    throw new Error("META_ACCESS_TOKEN manquant (ou DEMO_MODE=true sans API réelle)");
  }
  if (!config.metaAds.adAccountId) throw new Error("META_AD_ACCOUNT_ID manquant");
  return { token: config.metaAds.accessToken, account: config.metaAds.adAccountId };
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
  if (input.dailyBudget) body.daily_budget = String(input.dailyBudget);
  if (input.startDate) body.start_time = input.startDate.toISOString();
  if (input.endDate) body.stop_time = input.endDate.toISOString();

  const params = new URLSearchParams(body);
  params.append("special_ad_categories", "[]");
  const data = await httpJson(`${GRAPH_URL}/act_${account}/campaigns`, {
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
    input.targeting ?? { geo_locations: { countries: ["FR"] }, age_min: 25, age_max: 65 };
  const body: Record<string, string> = {
    name: input.name,
    campaign_id: input.campaignId,
    billing_event: input.billingEvent ?? "IMPRESSIONS",
    optimization_goal: input.optimizationGoal ?? "REACH",
    targeting: JSON.stringify(targeting),
    status: "PAUSED",
  };
  if (input.dailyBudget) body.daily_budget = String(input.dailyBudget);

  const data = await httpJson(`${GRAPH_URL}/act_${account}/adsets`, {
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
  const data = await httpJson(`${GRAPH_URL}/act_${account}/adimages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const images = data.images ?? {};
  const hash = images[Object.keys(images)[0]]?.hash;
  if (!hash) throw new Error(`Upload image publicitaire échoué : ${JSON.stringify(data).slice(0, 300)}`);
  return hash;
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
      linkData.video_id = resolveMediaPath(input.mediaPath);
    } else {
      linkData.image_hash = await uploadAdImage(input.mediaPath);
    }
  }

  const body = new URLSearchParams({
    name: input.name,
    object_story_spec: JSON.stringify({ page_id: pageId, link_data: linkData }),
  });
  const data = await httpJson(`${GRAPH_URL}/act_${account}/adcreatives`, {
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
  const data = await httpJson(`${GRAPH_URL}/act_${account}/ads`, {
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
    `${GRAPH_URL}/act_${account}/campaigns?fields=id,name,status,objective,daily_budget`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return data?.data ?? [];
}
