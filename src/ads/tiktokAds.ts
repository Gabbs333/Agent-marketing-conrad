import { basename } from "node:path";
import { config } from "../config";
import { fileBlob, resolveMediaPath } from "../lib/files";
import { httpJson } from "../lib/http";

/**
 * TikTok Ads (Business API v1.3) :
 *  - création de campagnes, ad groups et annonces vidéo ;
 *  - upload de créatifs vidéo.
 */

const ADS_BASE = "https://business-api.tiktok.com/open_api/v1.3";

function ready(): boolean {
  return !config.demoMode && !!config.tiktok.accessToken && !!config.tiktokAds.advertiserId;
}

async function call(path: string, body: Record<string, unknown>): Promise<any> {
  if (!ready()) {
    console.log(`[tiktokAds][demo] ${path} simulé`);
    return { code: 0, data: { id: `demo_${Date.now()}` } };
  }
  const data = await httpJson(`${ADS_BASE}${path}`, {
    method: "POST",
    headers: {
      "Access-Token": config.tiktok.accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (data.code !== 0) {
    throw new Error(`TikTok Ads API erreur ${data.code}: ${data.message}`);
  }
  return data;
}

export async function createCampaign(input: {
  name: string;
  objectiveType?: string;
  budget: number;
  budgetMode?: string;
}): Promise<{ id: string }> {
  const data = await call("/campaign/create/", {
    advertiser_id: config.tiktokAds.advertiserId,
    campaign_name: input.name,
    objective_type: input.objectiveType ?? "TRAFFIC",
    budget: input.budget,
    budget_mode: input.budgetMode ?? "BUDGET_MODE_DAY",
  });
  return { id: String(data.data?.campaign_id ?? data.data?.id ?? "") };
}

export async function createAdGroup(input: {
  campaignId: string;
  name: string;
  budget?: number;
  placements?: string[];
  locationIds?: string[];
}): Promise<{ id: string }> {
  const data = await call("/adgroup/create/", {
    advertiser_id: config.tiktokAds.advertiserId,
    campaign_id: input.campaignId,
    adgroup_name: input.name,
    placements: input.placements ?? ["PLACEMENT_TIKTOK"],
    location_ids: input.locationIds ?? ["6252001"], // France
    budget: input.budget,
    billing_event: "CPM",
    optimization_goal: "REACH",
  });
  return { id: String(data.data?.adgroup_id ?? data.data?.id ?? "") };
}

/** Upload d'un créatif vidéo (multipart direct). */
export async function uploadVideoCreative(filePath: string): Promise<string> {
  if (!ready()) return `demo_video_${Date.now()}`;
  const path = resolveMediaPath(filePath);
  const form = new FormData();
  form.append("advertiser_id", config.tiktokAds.advertiserId);
  form.append("upload_type", "UPLOAD_BY_FILE");
  form.append("file_name", basename(path));
  form.append("file", await fileBlob(path), basename(path));
  const data = await httpJson(`${ADS_BASE}/file/video/ad/upload/`, {
    method: "POST",
    headers: { "Access-Token": config.tiktok.accessToken },
    body: form,
  });
  if (data.code !== 0) {
    throw new Error(`Upload vidéo TikTok Ads échoué ${data.code}: ${data.message}`);
  }
  return String(data.data?.video_id ?? data.data?.id ?? data.data?.material_id ?? "");
}

export async function createAd(input: {
  adGroupId: string;
  name: string;
  videoId?: string;
  identityId?: string;
}): Promise<{ id: string }> {
  if (ready() && !input.identityId && !config.tiktok.identityId) {
    throw new Error("TIKTOK_IDENTITY_ID est requis pour créer une annonce TikTok");
  }
  const data = await call("/ad/create/", {
    advertiser_id: config.tiktokAds.advertiserId,
    adgroup_id: input.adGroupId,
    creatives: [
      {
        ad_name: input.name,
        ad_format: "SINGLE_VIDEO",
        identity_type: "CUSTOMIZED_IDENTITY",
        identity_id: input.identityId ?? config.tiktok.identityId,
        creatives: input.videoId ? [{ video_id: input.videoId }] : [],
      },
    ],
  });
  return { id: String(data.data?.ad_id ?? data.data?.id ?? "") };
}

/** Active (ENABLE) ou désactive (DISABLE) une campagne TikTok Ads. */
export async function updateCampaignStatus(
  campaignId: string,
  status: "ENABLE" | "DISABLE",
): Promise<void> {
  if (!ready()) {
    console.log(`[tiktokAds][demo] Campagne ${campaignId} → ${status}`);
    return;
  }
  await call("/campaign/status/update/", {
    advertiser_id: config.tiktokAds.advertiserId,
    campaign_ids: [campaignId],
    operation_status: status,
  });
}
