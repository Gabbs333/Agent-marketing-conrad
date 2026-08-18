"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIntegrationStatus = getIntegrationStatus;
const config_1 = require("../config");
const http_1 = require("../lib/http");
const facebook_1 = require("../social/facebook");
const tiktok_1 = require("../social/tiktok");
/**
 * État des intégrations externes : configuration présente + validité
 * (les tokens sont réellement vérifiés auprès des API, sauf en mode démo
 * où la vérification réseau est désactivée).
 */
const GRAPH_URL = "https://graph.facebook.com/v20.0";
const TIKTOK_ADS = "https://business-api.tiktok.com/open_api/v1.3";
async function safe(fn) {
    try {
        return { ok: true, value: await fn() };
    }
    catch (e) {
        return { ok: false, error: e.message.slice(0, 200) };
    }
}
async function getIntegrationStatus() {
    const demo = config_1.config.demoMode;
    const out = [];
    const notConfigured = "non configuré";
    // Facebook Page + Messenger (mêmes identifiants de page)
    {
        const configured = !!(config_1.config.facebook.pageId && config_1.config.facebook.pageToken);
        let valid = null;
        let detail = notConfigured;
        if (configured) {
            if (demo) {
                detail = "configuré — vérification désactivée en mode démo";
            }
            else {
                const r = await safe(() => (0, facebook_1.validatePageToken)());
                if (r.ok) {
                    valid = true;
                    detail = `Page « ${r.value.name} » (${r.value.id})`;
                }
                else {
                    valid = false;
                    detail = r.error;
                }
            }
        }
        const base = { configured, valid, detail };
        out.push({ key: "facebook", label: "Facebook Page", ...base });
        out.push({ key: "messenger", label: "Messenger", ...base });
    }
    // WhatsApp Business
    {
        const configured = !!(config_1.config.whatsapp.phoneNumberId && config_1.config.whatsapp.accessToken);
        out.push({
            key: "whatsapp",
            label: "WhatsApp Business",
            configured,
            valid: null,
            detail: configured
                ? demo
                    ? `numéro ${config_1.config.whatsapp.phoneNumberId} configuré (mode démo)`
                    : `numéro ${config_1.config.whatsapp.phoneNumberId} configuré — testez avec un message réel`
                : notConfigured,
        });
    }
    // Meta Ads
    {
        const configured = !!(config_1.config.metaAds.accessToken && config_1.config.metaAds.adAccountId);
        let valid = null;
        let detail = notConfigured;
        if (configured && !demo) {
            const r = await safe(async () => {
                const data = await (0, http_1.httpJson)(`${GRAPH_URL}/act_${config_1.config.metaAds.adAccountId}?fields=name`, { headers: { Authorization: `Bearer ${config_1.config.metaAds.accessToken}` } });
                return String(data.name ?? "compte publicitaire");
            });
            if (r.ok) {
                valid = true;
                detail = `Compte « ${r.value} »`;
            }
            else {
                valid = false;
                detail = r.error;
            }
        }
        else if (configured) {
            detail = `compte ${config_1.config.metaAds.adAccountId} configuré (mode démo)`;
        }
        out.push({ key: "metaAds", label: "Meta Ads", configured, valid, detail });
    }
    // TikTok Content Posting
    {
        const configured = !!config_1.config.tiktok.accessToken;
        let valid = null;
        let detail = notConfigured;
        if (configured && !demo) {
            const r = await safe(() => (0, tiktok_1.getUserInfo)());
            if (r.ok) {
                valid = true;
                detail = `Compte « ${r.value.displayName} » (open_id ${r.value.openId})`;
            }
            else {
                valid = false;
                detail = r.error;
            }
        }
        else if (configured) {
            detail = "token configuré (mode démo)";
        }
        out.push({ key: "tiktok", label: "TikTok (publication)", configured, valid, detail });
    }
    // TikTok Ads
    {
        const configured = !!(config_1.config.tiktokAds.advertiserId && config_1.config.tiktok.accessToken);
        let valid = null;
        let detail = notConfigured;
        if (configured && !demo) {
            const r = await safe(async () => {
                const data = await (0, http_1.httpJson)(`${TIKTOK_ADS}/oauth2/advertiser/get/?advertiser_ids=${encodeURIComponent(JSON.stringify([config_1.config.tiktokAds.advertiserId]))}`, { headers: { "Access-Token": config_1.config.tiktok.accessToken } });
                if (data.code !== 0)
                    throw new Error(data.message ?? "erreur TikTok Ads");
                return data;
            });
            if (r.ok) {
                valid = true;
                detail = `Advertiser ${config_1.config.tiktokAds.advertiserId} accessible`;
            }
            else {
                valid = false;
                detail = r.error;
            }
        }
        else if (configured) {
            detail = `advertiser ${config_1.config.tiktokAds.advertiserId} configuré (mode démo)`;
        }
        out.push({ key: "tiktokAds", label: "TikTok Ads", configured, valid, detail });
    }
    // OpenAI (textes, images, voix off)
    out.push({
        key: "openai",
        label: "OpenAI (IA)",
        configured: !!config_1.config.openai.apiKey,
        valid: null,
        detail: config_1.config.openai.apiKey ? `modèle ${config_1.config.openai.model}` : notConfigured,
    });
    // Email SMTP
    out.push({
        key: "email",
        label: "Email (SMTP)",
        configured: !!(config_1.config.email.host && config_1.config.email.user),
        valid: null,
        detail: config_1.config.email.host && config_1.config.email.user ? `serveur ${config_1.config.email.host}` : notConfigured,
    });
    return out;
}
//# sourceMappingURL=status.js.map