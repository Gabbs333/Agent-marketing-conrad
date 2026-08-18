"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadAndPublishVideo = uploadAndPublishVideo;
exports.publishPhoto = publishPhoto;
exports.buildAuthUrl = buildAuthUrl;
exports.getAccessToken = getAccessToken;
exports.getUserInfo = getUserInfo;
const promises_1 = require("node:fs/promises");
const config_1 = require("../config");
const http_1 = require("../lib/http");
/**
 * Publication TikTok via la Content Posting API v2 :
 *  - upload vidéo (init → PUT → sondage de statut) ;
 *  - publication photo ;
 *  - échange de code OAuth contre un access token.
 */
const TIKTOK_API = "https://open.tiktokapis.com/v2";
async function toBuffer(pathOrUrl) {
    if (/^https?:\/\//.test(pathOrUrl)) {
        const res = await fetch(pathOrUrl);
        if (!res.ok)
            throw new Error(`Téléchargement du média échoué (${res.status})`);
        return Buffer.from(await res.arrayBuffer());
    }
    return (0, promises_1.readFile)(pathOrUrl);
}
function authHeaders() {
    return {
        Authorization: `Bearer ${config_1.config.tiktok.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
    };
}
async function uploadAndPublishVideo(input) {
    if (config_1.config.demoMode || !config_1.config.tiktok.accessToken) {
        console.log(`[tiktok][demo] Vidéo simulée : ${input.caption.slice(0, 80)}`);
        return { id: `demo_tt_${Date.now()}`, scheduled: false };
    }
    const buf = await toBuffer(input.videoPath);
    const size = buf.length;
    const chunkSize = Math.min(5 * 1024 * 1024, size);
    const totalChunks = Math.ceil(size / chunkSize);
    // 1. Initialisation de l'upload
    const init = await (0, http_1.httpJson)(`${TIKTOK_API}/post/publish/video/init/`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
            post_info: {
                title: input.caption.slice(0, 2200),
                description: input.caption.slice(0, 2200),
                privacy_level: "SELF_ONLY",
                disable_comment: false,
                disable_duet: false,
                disable_stitch: false,
            },
            source_info: {
                source: "FILE_UPLOAD",
                video_size: size,
                chunk_size: chunkSize,
                total_chunk_count: totalChunks,
            },
        }),
    });
    const publishId = init.data?.publish_id;
    const uploadUrl = init.data?.upload_url;
    if (!publishId || !uploadUrl) {
        throw new Error(`Initialisation TikTok invalide : ${JSON.stringify(init).slice(0, 400)}`);
    }
    // 2. Upload des octets
    const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
            "Content-Type": "video/mp4",
            "Content-Range": `bytes 0-${size - 1}/${size}`,
        },
        body: new Uint8Array(buf),
    });
    if (!put.ok) {
        throw new Error(`Upload TikTok échoué (${put.status}) : ${(await put.text()).slice(0, 300)}`);
    }
    // 3. Sondage du statut de publication
    for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await (0, http_1.httpJson)(`${TIKTOK_API}/post/publish/status/fetch/`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ publish_id: publishId }),
        });
        const status = st.data?.status;
        if (status === "PUBLISH_COMPLETE")
            return { id: publishId, scheduled: false };
        if (status === "FAILED") {
            throw new Error(`Publication TikTok échouée : ${st.data?.fail_reason ?? "raison inconnue"}`);
        }
    }
    return { id: publishId, scheduled: false };
}
async function publishPhoto(input) {
    if (config_1.config.demoMode || !config_1.config.tiktok.accessToken) {
        console.log(`[tiktok][demo] Photo simulée : ${input.caption.slice(0, 80)}`);
        return { id: `demo_tt_${Date.now()}`, scheduled: false };
    }
    const buf = await toBuffer(input.imagePath);
    const size = buf.length;
    const chunkSize = Math.min(5 * 1024 * 1024, size);
    // 1. Init pour la photo de couverture
    const init = await (0, http_1.httpJson)(`${TIKTOK_API}/post/publish/photo/init/`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
            post_info: {
                title: input.caption.slice(0, 2200),
                privacy_level: "SELF_ONLY",
                disable_comment: false,
                disable_duet: false,
                disable_stitch: false,
            },
            source_info: {
                source: "FILE_UPLOAD",
                photo_cover_size: size,
                chunk_size: chunkSize,
                total_chunk_count: Math.ceil(size / chunkSize),
            },
        }),
    });
    const publishId = init.data?.publish_id;
    const uploadUrl = init.data?.upload_url;
    if (!publishId || !uploadUrl) {
        throw new Error(`Initialisation photo TikTok invalide : ${JSON.stringify(init).slice(0, 400)}`);
    }
    const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
            "Content-Type": "image/jpeg",
            "Content-Range": `bytes 0-${size - 1}/${size}`,
        },
        body: new Uint8Array(buf),
    });
    if (!put.ok) {
        throw new Error(`Upload photo TikTok échoué (${put.status})`);
    }
    // 2. Rattachement de la photo comme image du post
    const attach = await (0, http_1.httpJson)(`${TIKTOK_API}/post/publish/photo/init/`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ publish_id: publishId, photo_images: [publishId] }),
    });
    if (!attach.data?.publish_id) {
        throw new Error(`Rattachement photo TikTok échoué : ${JSON.stringify(attach).slice(0, 300)}`);
    }
    return { id: attach.data.publish_id, scheduled: false };
}
/** URL d'autorisation OAuth à donner à l'utilisateur de la page. */
function buildAuthUrl(redirectUri, scopes) {
    const scope = encodeURIComponent(scopes.join(","));
    const redirect = encodeURIComponent(redirectUri);
    return `https://www.tiktok.com/v2/auth/authorize/?client_key=${config_1.config.tiktok.clientKey}&scope=${scope}&response_type=code&redirect_uri=${redirect}`;
}
/** Échange le code OAuth contre un access token. */
async function getAccessToken(code, redirectUri) {
    if (!config_1.config.tiktok.clientKey || !config_1.config.tiktok.clientSecret) {
        throw new Error("TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET sont requis");
    }
    const data = await (0, http_1.httpJson)(`${TIKTOK_API}/oauth/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_key: config_1.config.tiktok.clientKey,
            client_secret: config_1.config.tiktok.clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
        }),
    });
    if (!data.access_token)
        throw new Error(`OAuth TikTok échoué : ${JSON.stringify(data).slice(0, 300)}`);
    return data.access_token;
}
/** Vérifie qu'un access token TikTok est valide et renvoie l'identité du compte. */
async function getUserInfo(token) {
    const t = token ?? config_1.config.tiktok.accessToken;
    if (!t)
        throw new Error("TIKTOK_ACCESS_TOKEN manquant");
    const data = await (0, http_1.httpJson)(`${TIKTOK_API}/user/info/?fields=open_id,display_name`, {
        headers: { Authorization: `Bearer ${t}` },
    });
    return {
        openId: String(data.data?.open_id ?? ""),
        displayName: String(data.data?.display_name ?? ""),
    };
}
//# sourceMappingURL=tiktok.js.map