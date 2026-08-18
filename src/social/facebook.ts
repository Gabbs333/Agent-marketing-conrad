import { basename } from "node:path";
import { config } from "../config";
import { fileBlob, resolveMediaPath } from "../lib/files";
import { httpJson } from "../lib/http";
import type { PublishResult } from "../types";

/**
 * Publication Facebook via la Graph API :
 *  - posts texte, photo et vidéo (upload multipart ou URL) ;
 *  - publication planifiée (scheduled_publish_time) ;
 *  - statistiques de posts (insights).
 */

const GRAPH_URL = "https://graph.facebook.com/v20.0";

export interface FacebookPublishInput {
  text: string;
  mediaPath?: string; // fichier local ou URL http(s)
  mediaType?: "image" | "video";
  scheduledAt?: Date;
}

export async function publishToFacebook(input: FacebookPublishInput): Promise<PublishResult> {
  if (config.demoMode || !config.facebook.pageToken) {
    console.log(
      `[facebook][demo] Publication simulée : ${input.text.slice(0, 80)}${input.mediaPath ? ` (média : ${input.mediaPath})` : ""}`,
    );
    return { id: `demo_fb_${Date.now()}`, scheduled: !!input.scheduledAt };
  }

  const pageId = config.facebook.pageId;
  if (!pageId) throw new Error("FB_PAGE_ID manquant dans la configuration");
  const token = config.facebook.pageToken;
  const scheduled = input.scheduledAt ? Math.floor(input.scheduledAt.getTime() / 1000) : undefined;
  const auth = { Authorization: `Bearer ${token}` };

  if (input.mediaPath) {
    const mediaPath = resolveMediaPath(input.mediaPath);

    if (input.mediaType === "video") {
      const form = new FormData();
      if (mediaPath.startsWith("http")) {
        form.append("file_url", mediaPath);
      } else {
        form.append("source", await fileBlob(mediaPath), basename(mediaPath));
      }
      form.append("description", input.text);
      if (scheduled) {
        form.append("published", "false");
        form.append("scheduled_publish_time", String(scheduled));
      }
      const data = await httpJson(`${GRAPH_URL}/${pageId}/videos`, {
        method: "POST",
        headers: auth,
        body: form,
      });
      return { id: String(data.id ?? data.post_id ?? ""), scheduled: !!scheduled };
    }

    // Photo
    const form = new FormData();
    if (mediaPath.startsWith("http")) {
      form.append("url", mediaPath);
    } else {
      form.append("source", await fileBlob(mediaPath), basename(mediaPath));
    }
    form.append("caption", input.text);
    if (scheduled) {
      form.append("published", "false");
      form.append("scheduled_publish_time", String(scheduled));
    }
    const data = await httpJson(`${GRAPH_URL}/${pageId}/photos`, {
      method: "POST",
      headers: auth,
      body: form,
    });
    return { id: String(data.id ?? data.post_id ?? ""), scheduled: !!scheduled };
  }

  // Texte seul
  const body: Record<string, string> = { message: input.text };
  if (scheduled) {
    body.published = "false";
    body.scheduled_publish_time = String(scheduled);
  }
  const data = await httpJson(`${GRAPH_URL}/${pageId}/feed`, {
    method: "POST",
    headers: auth,
    body: new URLSearchParams(body),
  });
  return { id: String(data.id ?? ""), scheduled: !!scheduled };
}

/** Statistiques d'un post publié (impressions, engagements, clics). */
export async function getPostInsights(
  postId: string,
  metrics: string[] = ["post_impressions", "post_engagements", "post_clicks"],
): Promise<Record<string, number>> {
  if (config.demoMode) {
    return {
      post_impressions: 800 + Math.floor(Math.random() * 3000),
      post_engagements: 60 + Math.floor(Math.random() * 400),
      post_clicks: 10 + Math.floor(Math.random() * 120),
    };
  }
  const data = await httpJson(
    `${GRAPH_URL}/${postId}/insights?metric=${metrics.join(",")}`,
    { headers: { Authorization: `Bearer ${config.facebook.pageToken}` } },
  );
  const out: Record<string, number> = {};
  for (const row of data?.data ?? []) {
    out[row.name] = Number(row.values?.[0]?.value ?? 0);
  }
  return out;
}

/** Échange un token court contre un token longue durée. */
export async function getLongLivedPageToken(
  shortToken: string,
): Promise<string> {
  const appId = config.facebook.appId;
  const appSecret = config.facebook.appSecret;
  if (!appId || !appSecret) {
    throw new Error("FB_APP_ID et FB_APP_SECRET sont requis pour un token longue durée");
  }
  const data = await httpJson(
    `${GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
  );
  if (!data.access_token) throw new Error("Échange de token Facebook échoué");
  return data.access_token;
}

export const exchangeLongLivedToken = getLongLivedPageToken;

/** Liste les pages accessibles avec un token utilisateur (longue durée). */
export async function listPages(
  userToken: string,
): Promise<{ id: string; name: string; access_token: string }[]> {
  const data = await httpJson(
    `${GRAPH_URL}/me/accounts?fields=id,name,access_token`,
    { headers: { Authorization: `Bearer ${userToken}` } },
  );
  return data?.data ?? [];
}

/** Vérifie qu'un token de page est valide et renvoie l'identité de la page. */
export async function validatePageToken(token?: string): Promise<{ id: string; name: string }> {
  const t = token ?? config.facebook.pageToken;
  if (!t) throw new Error("FB_PAGE_TOKEN manquant");
  const data = await httpJson(`${GRAPH_URL}/me?fields=id,name`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  return { id: String(data.id ?? ""), name: String(data.name ?? "") };
}
