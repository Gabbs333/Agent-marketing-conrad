"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAdAccountId = formatAdAccountId;
exports.createCampaign = createCampaign;
exports.createAdSet = createAdSet;
exports.uploadAdImage = uploadAdImage;
exports.uploadPageVideo = uploadPageVideo;
exports.createAdCreative = createAdCreative;
exports.createAd = createAd;
exports.updateCampaignStatus = updateCampaignStatus;
exports.listCampaigns = listCampaigns;
const node_path_1 = require("node:path");
const config_1 = require("../config");
const files_1 = require("../lib/files");
const http_1 = require("../lib/http");
/**
 * Meta Ads (Marketing API) :
 *  - création de campagnes, ad sets, créatifs et annonces ;
 *  - upload d'images pour obtenir un image_hash ;
 *  - ciblage, budgets et statuts.
 */
const GRAPH_URL = "https://graph.facebook.com/v20.0";
function formatAdAccountId(id) {
    const clean = id.trim().replace(/^act_/i, "");
    return `act_${clean}`;
}
function requireAccount() {
    if (config_1.config.demoMode || !config_1.config.metaAds.accessToken) {
        throw new Error("META_ACCESS_TOKEN manquant (ou DEMO_MODE=true sans API réelle)");
    }
    if (!config_1.config.metaAds.adAccountId)
        throw new Error("META_AD_ACCOUNT_ID manquant");
    return { token: config_1.config.metaAds.accessToken, account: formatAdAccountId(config_1.config.metaAds.adAccountId) };
}
async function createCampaign(input) {
    if (config_1.config.demoMode || !config_1.config.metaAds.accessToken) {
        console.log(`[metaAds][demo] Campagne simulée : ${input.name}`);
        return { id: `demo_mc_${Date.now()}` };
    }
    const { token, account } = requireAccount();
    const body = {
        name: input.name,
        objective: input.objective ?? "OUTCOME_TRAFFIC",
        status: input.status ?? "PAUSED",
    };
    if (input.dailyBudget)
        body.daily_budget = String(input.dailyBudget);
    if (input.startDate)
        body.start_time = input.startDate.toISOString();
    if (input.endDate)
        body.stop_time = input.endDate.toISOString();
    const params = new URLSearchParams(body);
    params.append("special_ad_categories", "[]");
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/${account}/campaigns`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: params,
    });
    return { id: String(data.id ?? "") };
}
async function createAdSet(input) {
    if (config_1.config.demoMode || !config_1.config.metaAds.accessToken) {
        return { id: `demo_ms_${Date.now()}` };
    }
    const { token, account } = requireAccount();
    const targeting = input.targeting ?? { geo_locations: { countries: ["FR"] }, age_min: 25, age_max: 65 };
    const body = {
        name: input.name,
        campaign_id: input.campaignId,
        billing_event: input.billingEvent ?? "IMPRESSIONS",
        optimization_goal: input.optimizationGoal ?? "REACH",
        targeting: JSON.stringify(targeting),
        status: "PAUSED",
    };
    if (input.dailyBudget)
        body.daily_budget = String(input.dailyBudget);
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/${account}/adsets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: new URLSearchParams(body),
    });
    return { id: String(data.id ?? "") };
}
/** Upload d'une image dans le compte publicitaire → image_hash. */
async function uploadAdImage(filePath) {
    if (config_1.config.demoMode || !config_1.config.metaAds.accessToken)
        return `demo_hash_${Date.now()}`;
    const { token, account } = requireAccount();
    const path = (0, files_1.resolveMediaPath)(filePath);
    const form = new FormData();
    form.append("filename", await (0, files_1.fileBlob)(path), (0, node_path_1.basename)(path));
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/${account}/adimages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
    });
    const images = data.images ?? {};
    const hash = images[Object.keys(images)[0]]?.hash;
    if (!hash)
        throw new Error(`Upload image publicitaire échoué : ${JSON.stringify(data).slice(0, 300)}`);
    return hash;
}
/** Upload d'une vidéo sur la bibliothèque vidéo de la page → video_id pour les créatifs. */
async function uploadPageVideo(filePath) {
    if (config_1.config.demoMode || !config_1.config.metaAds.accessToken)
        return `demo_video_${Date.now()}`;
    const pageId = config_1.config.facebook.pageId;
    const token = config_1.config.facebook.pageToken;
    if (!pageId || !token)
        throw new Error("FB_PAGE_ID / FB_PAGE_TOKEN manquants pour uploader la vidéo");
    const path = (0, files_1.resolveMediaPath)(filePath);
    const form = new FormData();
    if (path.startsWith("http")) {
        form.append("file_url", path);
    }
    else {
        form.append("source", await (0, files_1.fileBlob)(path), (0, node_path_1.basename)(path));
    }
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/${pageId}/videos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
    });
    const id = String(data.id ?? "");
    if (!id)
        throw new Error(`Upload vidéo page échoué : ${JSON.stringify(data).slice(0, 300)}`);
    return id;
}
async function createAdCreative(input) {
    if (config_1.config.demoMode || !config_1.config.metaAds.accessToken) {
        return { id: `demo_cr_${Date.now()}` };
    }
    const { token, account } = requireAccount();
    const pageId = config_1.config.facebook.pageId;
    if (!pageId)
        throw new Error("FB_PAGE_ID manquant pour le créatif publicitaire");
    const linkData = {
        message: input.message,
        link: input.link ?? config_1.config.hotel.website,
        call_to_action: {
            type: "LEARN_MORE",
            value: { link: input.link ?? config_1.config.hotel.website },
        },
    };
    if (input.mediaPath) {
        if (input.mediaType === "video") {
            linkData.video_id = await uploadPageVideo(input.mediaPath);
        }
        else {
            linkData.image_hash = await uploadAdImage(input.mediaPath);
        }
    }
    const body = new URLSearchParams({
        name: input.name,
        object_story_spec: JSON.stringify({ page_id: pageId, link_data: linkData }),
    });
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/${account}/adcreatives`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
    });
    return { id: String(data.id ?? "") };
}
async function createAd(input) {
    if (config_1.config.demoMode || !config_1.config.metaAds.accessToken) {
        return { id: `demo_ad_${Date.now()}` };
    }
    const { token, account } = requireAccount();
    const body = new URLSearchParams({
        name: input.name,
        adset_id: input.adsetId,
        status: "PAUSED",
        creative: JSON.stringify({ creative_id: input.creativeId }),
    });
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/${account}/ads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
    });
    return { id: String(data.id ?? "") };
}
async function updateCampaignStatus(campaignId, status) {
    if (config_1.config.demoMode || !config_1.config.metaAds.accessToken) {
        console.log(`[metaAds][demo] Campagne ${campaignId} → ${status}`);
        return;
    }
    const { token } = requireAccount();
    await (0, http_1.httpJson)(`${GRAPH_URL}/${campaignId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: new URLSearchParams({ status }),
    });
}
async function listCampaigns() {
    if (config_1.config.demoMode || !config_1.config.metaAds.accessToken)
        return [];
    const { token, account } = requireAccount();
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/${account}/campaigns?fields=id,name,status,objective,daily_budget`, { headers: { Authorization: `Bearer ${token}` } });
    return data?.data ?? [];
}
//# sourceMappingURL=metaAds.js.map