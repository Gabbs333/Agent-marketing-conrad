import { config } from "../config";
import { httpJson } from "../lib/http";
import { validatePageToken } from "../social/facebook";
import { getUserInfo } from "../social/tiktok";

/**
 * État des intégrations externes : configuration présente + validité
 * (les tokens sont réellement vérifiés auprès des API, sauf en mode démo
 * où la vérification réseau est désactivée).
 */

const GRAPH_URL = "https://graph.facebook.com/v20.0";
const TIKTOK_ADS = "https://business-api.tiktok.com/open_api/v1.3";

export interface IntegrationStatus {
  key: string;
  label: string;
  configured: boolean;
  valid: boolean | null; // null = non vérifiable (mode démo / pas de réseau)
  detail: string;
}

async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 200) };
  }
}

export async function getIntegrationStatus(): Promise<IntegrationStatus[]> {
  const demo = config.demoMode;
  const out: IntegrationStatus[] = [];
  const notConfigured = "non configuré";

  // Facebook Page + Messenger (mêmes identifiants de page)
  {
    const configured = !!(config.facebook.pageId && config.facebook.pageToken);
    let valid: boolean | null = null;
    let detail = notConfigured;
    if (configured) {
      if (demo) {
        detail = "configuré — vérification désactivée en mode démo";
      } else {
        const r = await safe(() => validatePageToken());
        if (r.ok) {
          valid = true;
          detail = `Page « ${r.value.name} » (${r.value.id})`;
        } else {
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
    const configured = !!(config.whatsapp.phoneNumberId && config.whatsapp.accessToken);
    out.push({
      key: "whatsapp",
      label: "WhatsApp Business",
      configured,
      valid: null,
      detail: configured
        ? demo
          ? `numéro ${config.whatsapp.phoneNumberId} configuré (mode démo)`
          : `numéro ${config.whatsapp.phoneNumberId} configuré — testez avec un message réel`
        : notConfigured,
    });
  }

  // Meta Ads
  {
    const configured = !!(config.metaAds.accessToken && config.metaAds.adAccountId);
    let valid: boolean | null = null;
    let detail = notConfigured;
    if (configured && !demo) {
      const r = await safe(async () => {
        const data = await httpJson(
          `${GRAPH_URL}/act_${config.metaAds.adAccountId}?fields=name`,
          { headers: { Authorization: `Bearer ${config.metaAds.accessToken}` } },
        );
        return String(data.name ?? "compte publicitaire");
      });
      if (r.ok) {
        valid = true;
        detail = `Compte « ${r.value} »`;
      } else {
        valid = false;
        detail = r.error;
      }
    } else if (configured) {
      detail = `compte ${config.metaAds.adAccountId} configuré (mode démo)`;
    }
    out.push({ key: "metaAds", label: "Meta Ads", configured, valid, detail });
  }

  // TikTok Content Posting
  {
    const configured = !!config.tiktok.accessToken;
    let valid: boolean | null = null;
    let detail = notConfigured;
    if (configured && !demo) {
      const r = await safe(() => getUserInfo());
      if (r.ok) {
        valid = true;
        detail = `Compte « ${r.value.displayName} » (open_id ${r.value.openId})`;
      } else {
        valid = false;
        detail = r.error;
      }
    } else if (configured) {
      detail = "token configuré (mode démo)";
    }
    out.push({ key: "tiktok", label: "TikTok (publication)", configured, valid, detail });
  }

  // TikTok Ads
  {
    const configured = !!(config.tiktokAds.advertiserId && config.tiktok.accessToken);
    let valid: boolean | null = null;
    let detail = notConfigured;
    if (configured && !demo) {
      const r = await safe(async () => {
        const data = await httpJson(
          `${TIKTOK_ADS}/oauth2/advertiser/get/?advertiser_ids=${encodeURIComponent(
            JSON.stringify([config.tiktokAds.advertiserId]),
          )}`,
          { headers: { "Access-Token": config.tiktok.accessToken } },
        );
        if (data.code !== 0) throw new Error(data.message ?? "erreur TikTok Ads");
        return data;
      });
      if (r.ok) {
        valid = true;
        detail = `Advertiser ${config.tiktokAds.advertiserId} accessible`;
      } else {
        valid = false;
        detail = r.error;
      }
    } else if (configured) {
      detail = `advertiser ${config.tiktokAds.advertiserId} configuré (mode démo)`;
    }
    out.push({ key: "tiktokAds", label: "TikTok Ads", configured, valid, detail });
  }

  // OpenAI (textes, images, voix off)
  out.push({
    key: "openai",
    label: "OpenAI (IA)",
    configured: !!config.openai.apiKey,
    valid: null,
    detail: config.openai.apiKey ? `modèle ${config.openai.model}` : notConfigured,
  });

  // Email SMTP
  out.push({
    key: "email",
    label: "Email (SMTP)",
    configured: !!(config.email.host && config.email.user),
    valid: null,
    detail: config.email.host && config.email.user ? `serveur ${config.email.host}` : notConfigured,
  });

  return out;
}
