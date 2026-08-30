"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCampaign = createCampaign;
exports.createAdGroup = createAdGroup;
exports.uploadVideoCreative = uploadVideoCreative;
exports.createAd = createAd;
exports.updateCampaignStatus = updateCampaignStatus;
const node_path_1 = require("node:path");
const config_1 = require("../config");
const files_1 = require("../lib/files");
const http_1 = require("../lib/http");
/**
 * TikTok Ads (Business API v1.3) :
 *  - création de campagnes, ad groups et annonces vidéo ;
 *  - upload de créatifs vidéo.
 */
const ADS_BASE = "https://business-api.tiktok.com/open_api/v1.3";
function ready() {
    return !config_1.config.demoMode && !!config_1.config.tiktok.accessToken && !!config_1.config.tiktokAds.advertiserId;
}
async function call(path, body) {
    if (!ready()) {
        console.log(`[tiktokAds][demo] ${path} simulé`);
        return { code: 0, data: { id: `demo_${Date.now()}` } };
    }
    const data = await (0, http_1.httpJson)(`${ADS_BASE}${path}`, {
        method: "POST",
        headers: {
            "Access-Token": config_1.config.tiktok.accessToken,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (data.code !== 0) {
        throw new Error(`TikTok Ads API erreur ${data.code}: ${data.message}`);
    }
    return data;
}
async function createCampaign(input) {
    const data = await call("/campaign/create/", {
        advertiser_id: config_1.config.tiktokAds.advertiserId,
        campaign_name: input.name,
        objective_type: input.objectiveType ?? "TRAFFIC",
        budget: input.budget,
        budget_mode: input.budgetMode ?? "BUDGET_MODE_DAY",
    });
    return { id: String(data.data?.campaign_id ?? data.data?.id ?? "") };
}
async function createAdGroup(input) {
    const data = await call("/adgroup/create/", {
        advertiser_id: config_1.config.tiktokAds.advertiserId,
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
async function uploadVideoCreative(filePath) {
    if (!ready())
        return `demo_video_${Date.now()}`;
    const path = (0, files_1.resolveMediaPath)(filePath);
    const form = new FormData();
    form.append("advertiser_id", config_1.config.tiktokAds.advertiserId);
    form.append("upload_type", "UPLOAD_BY_FILE");
    form.append("file_name", (0, node_path_1.basename)(path));
    form.append("file", await (0, files_1.fileBlob)(path), (0, node_path_1.basename)(path));
    const data = await (0, http_1.httpJson)(`${ADS_BASE}/file/video/ad/upload/`, {
        method: "POST",
        headers: { "Access-Token": config_1.config.tiktok.accessToken },
        body: form,
    });
    if (data.code !== 0) {
        throw new Error(`Upload vidéo TikTok Ads échoué ${data.code}: ${data.message}`);
    }
    return String(data.data?.video_id ?? data.data?.id ?? data.data?.material_id ?? "");
}
async function createAd(input) {
    if (ready() && !input.identityId && !config_1.config.tiktok.identityId) {
        throw new Error("TIKTOK_IDENTITY_ID est requis pour créer une annonce TikTok");
    }
    const data = await call("/ad/create/", {
        advertiser_id: config_1.config.tiktokAds.advertiserId,
        adgroup_id: input.adGroupId,
        creatives: [
            {
                ad_name: input.name,
                ad_format: "SINGLE_VIDEO",
                identity_type: "CUSTOMIZED_IDENTITY",
                identity_id: input.identityId ?? config_1.config.tiktok.identityId,
                creatives: input.videoId ? [{ video_id: input.videoId }] : [],
            },
        ],
    });
    return { id: String(data.data?.ad_id ?? data.data?.id ?? "") };
}
/** Active (ENABLE) ou désactive (DISABLE) une campagne TikTok Ads. */
async function updateCampaignStatus(campaignId, status) {
    if (!ready()) {
        console.log(`[tiktokAds][demo] Campagne ${campaignId} → ${status}`);
        return;
    }
    await call("/campaign/status/update/", {
        advertiser_id: config_1.config.tiktokAds.advertiserId,
        campaign_ids: [campaignId],
        operation_status: status,
    });
}
//# sourceMappingURL=tiktokAds.js.map