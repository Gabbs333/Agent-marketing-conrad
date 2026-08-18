"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProvider = resolveProvider;
exports.generateImage = generateImage;
const config_1 = require("../config");
const db_1 = require("../db");
const http_1 = require("../lib/http");
const files_1 = require("../lib/files");
function parseSize(size) {
    const [w, h] = size.toLowerCase().split("x").map(Number);
    return [w || 1024, h || 1024];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function resolveProvider() {
    if (config_1.config.openai.apiKey)
        return "openai";
    if (config_1.config.stability.apiKey)
        return "stability";
    if (config_1.config.replicate.apiToken)
        return "replicate";
    if (config_1.config.fal.apiKey)
        return "fal";
    if (config_1.config.huggingface.apiKey)
        return "huggingface";
    if (config_1.config.together.apiKey)
        return "together";
    if (config_1.config.getimg.apiKey)
        return "getimg";
    if (config_1.config.localImageEndpoint)
        return "local";
    return "auto";
}
async function download(url) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Téléchargement de l'image échoué (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}
// ─── OpenAI ───────────────────────────────────────────────────
async function openaiImage(prompt, size) {
    const model = config_1.config.openai.imageModel;
    const body = (extra) => JSON.stringify({ model, prompt, n: 1, size, ...extra });
    try {
        const data = await (0, http_1.httpJson)("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${config_1.config.openai.apiKey}` },
            body: body({ response_format: "b64_json" }),
        });
        const b64 = data.data?.[0]?.b64_json;
        if (b64)
            return Buffer.from(b64, "base64");
        const url = data.data?.[0]?.url;
        if (url)
            return download(url);
        throw new Error("OpenAI n'a renvoyé aucune image");
    }
    catch (err) {
        const data = await (0, http_1.httpJson)("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${config_1.config.openai.apiKey}` },
            body: body({}),
        });
        const url = data.data?.[0]?.url;
        if (url)
            return download(url);
        throw err;
    }
}
// ─── Stability AI (SDXL) ──────────────────────────────────────
async function stabilityImage(prompt, size) {
    const [width, height] = parseSize(size);
    const res = await fetch(`https://api.stability.ai/v1/generation/${config_1.config.stability.engine}/text-to-image`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config_1.config.stability.apiKey}`,
            "Content-Type": "application/json",
            Accept: "image/png",
        },
        body: JSON.stringify({
            text_prompts: [{ text: prompt, weight: 1 }],
            cfg_scale: 7,
            height,
            width,
            steps: 30,
            samples: 1,
        }),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Stability API ${res.status}: ${txt.slice(0, 300)}`);
    }
    return Buffer.from(await res.arrayBuffer());
}
// ─── Replicate (Flux, SDXL…) ──────────────────────────────────
async function replicateImage(prompt, size) {
    const [width, height] = parseSize(size);
    const headers = { Authorization: `Bearer ${config_1.config.replicate.apiToken}`, "Content-Type": "application/json" };
    const model = config_1.config.image.replicateModel;
    const create = await (0, http_1.httpJson)(`https://api.replicate.com/v1/models/${model}/predictions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: { prompt, width, height, num_outputs: 1 } }),
    });
    const getUrl = create.urls?.get;
    const outputUrl = extractOutputUrl(create.output);
    if (outputUrl)
        return download(outputUrl);
    if (!getUrl)
        throw new Error("Réponse Replicate inattendue");
    for (let i = 0; i < 60; i++) {
        await sleep(2000);
        const st = await (0, http_1.httpJson)(getUrl, { headers });
        if (st.status === "succeeded") {
            const u = extractOutputUrl(st.output);
            if (u)
                return download(u);
            throw new Error("Replicate a réussi sans URL d'image");
        }
        if (st.status === "failed" || st.status === "canceled") {
            throw new Error(`Replicate a échoué : ${st.error ?? "raison inconnue"}`);
        }
    }
    throw new Error("Replicate : délai d'attente dépassé (2 min)");
}
function extractOutputUrl(output) {
    if (typeof output === "string")
        return output;
    if (Array.isArray(output) && typeof output[0] === "string")
        return output[0];
    const o = (Array.isArray(output) ? output[0] : output);
    return o?.url;
}
// ─── fal.ai (Flux…) ───────────────────────────────────────────
function falImageSize(size) {
    const [w, h] = parseSize(size);
    if (w > h)
        return "landscape_4_3";
    if (h > w)
        return "portrait_4_3";
    return "square_hd";
}
async function falImage(prompt, size) {
    const headers = { Authorization: `Key ${config_1.config.fal.apiKey}`, "Content-Type": "application/json" };
    const submit = await (0, http_1.httpJson)(`https://queue.fal.run/${config_1.config.image.falModel}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt, image_size: falImageSize(size) }),
    });
    const statusUrl = submit.status_url;
    if (!statusUrl)
        throw new Error("Réponse fal.ai inattendue");
    for (let i = 0; i < 60; i++) {
        await sleep(2000);
        const st = await (0, http_1.httpJson)(statusUrl, { headers });
        if (st.status === "COMPLETED") {
            const u = st.images?.[0]?.url ?? st.response?.images?.[0]?.url;
            if (u)
                return download(u);
            throw new Error("fal.ai a terminé sans URL d'image");
        }
        if (st.status === "FAILED" || st.status === "ERROR") {
            throw new Error("fal.ai a échoué");
        }
    }
    throw new Error("fal.ai : délai d'attente dépassé (2 min)");
}
// ─── Hugging Face Inference (Flux, SD…) ───────────────────────
async function hfImage(prompt) {
    const res = await fetch(`https://api-inference.huggingface.co/models/${config_1.config.image.hfModel}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config_1.config.huggingface.apiKey}`,
            "Content-Type": "application/json",
            "x-wait-for-model": "true",
        },
        body: JSON.stringify({ inputs: prompt }),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Hugging Face ${res.status}: ${txt.slice(0, 300)}`);
    }
    return Buffer.from(await res.arrayBuffer());
}
// ─── Together AI (Flux Schnell gratuit) ───────────────────────
async function togetherImage(prompt, size) {
    const [width, height] = parseSize(size);
    const data = await (0, http_1.httpJson)("https://api.together.xyz/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config_1.config.together.apiKey}` },
        body: JSON.stringify({
            model: config_1.config.image.togetherModel,
            prompt,
            width,
            height,
            steps: 4,
            n: 1,
            response_format: "b64_json",
        }),
    });
    const b64 = data.data?.[0]?.b64_json;
    if (!b64)
        throw new Error("Together n'a renvoyé aucune image");
    return Buffer.from(b64, "base64");
}
// ─── getimg.ai (SDXL) ─────────────────────────────────────────
async function getimgImage(prompt, size) {
    const [width, height] = parseSize(size);
    const data = await (0, http_1.httpJson)("https://api.getimg.ai/v1/stable-diffusion-xl/text-to-image", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config_1.config.getimg.apiKey}` },
        body: JSON.stringify({
            model: config_1.config.image.getimgModel,
            prompt,
            width,
            height,
            output_format: "png",
            response_format: "b64",
        }),
    });
    if (!data.image)
        throw new Error("getimg.ai n'a renvoyé aucune image");
    return Buffer.from(data.image, "base64");
}
// ─── Endpoint local (AUTOMATIC1111 / ComfyUI) ─────────────────
async function localImage(prompt, size) {
    const [width, height] = parseSize(size);
    const data = await (0, http_1.httpJson)(config_1.config.localImageEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, steps: 25, width, height }),
    });
    const b64 = data.images?.[0];
    if (!b64)
        throw new Error("Le générateur local n'a renvoyé aucune image");
    return Buffer.from(b64, "base64");
}
/** Image de démo : dégradé bleu nuit → doré, sans aucune API. */
function demoImage(size) {
    const [w, h] = parseSize(size);
    return (0, files_1.createPng)(w, h, (x, y) => {
        const t = y / h;
        const wave = Math.sin(x / 40) * 6;
        return [
            Math.round(16 + 30 * t),
            Math.round(42 + 34 * t),
            Math.round(58 + 120 * t + wave),
        ];
    });
}
async function generateImage(input) {
    const provider = input.provider === "auto" ? resolveProvider() : (input.provider ?? resolveProvider());
    const size = input.size ?? "1024x1024";
    const filename = input.filename ?? `${(0, files_1.slugify)(input.prompt)}-${Date.now()}.png`;
    const relPath = `assets/images/${filename}`;
    let buf;
    let used;
    if (config_1.config.demoMode) {
        buf = demoImage(size);
        used = "demo";
    }
    else if (provider === "openai" && config_1.config.openai.apiKey) {
        buf = await openaiImage(input.prompt, size);
        used = "openai";
    }
    else if (provider === "stability" && config_1.config.stability.apiKey) {
        buf = await stabilityImage(input.prompt, size);
        used = "stability";
    }
    else if (provider === "replicate" && config_1.config.replicate.apiToken) {
        buf = await replicateImage(input.prompt, size);
        used = "replicate";
    }
    else if (provider === "fal" && config_1.config.fal.apiKey) {
        buf = await falImage(input.prompt, size);
        used = "fal";
    }
    else if (provider === "huggingface" && config_1.config.huggingface.apiKey) {
        buf = await hfImage(input.prompt);
        used = "huggingface";
    }
    else if (provider === "together" && config_1.config.together.apiKey) {
        buf = await togetherImage(input.prompt, size);
        used = "together";
    }
    else if (provider === "getimg" && config_1.config.getimg.apiKey) {
        buf = await getimgImage(input.prompt, size);
        used = "getimg";
    }
    else if (provider === "local" && config_1.config.localImageEndpoint) {
        buf = await localImage(input.prompt, size);
        used = "local";
    }
    else {
        throw new Error(`Aucun générateur d'images configuré pour le provider « ${provider} ». ` +
            `Renseignez une clé (OPENAI_API_KEY, STABILITY_API_KEY, REPLICATE_API_TOKEN, FAL_KEY, HF_TOKEN, TOGETHER_API_KEY, GETIMG_API_KEY, LOCAL_IMAGE_ENDPOINT) ou laissez DEMO_MODE=true.`);
    }
    await (0, files_1.saveBuffer)(buf, relPath);
    const url = (0, files_1.publicUrl)(relPath);
    const asset = await db_1.prisma.mediaAsset.create({
        data: {
            type: "image",
            url,
            localPath: relPath,
            tags: `prompt:${input.prompt.slice(0, 200)};provider:${used}`,
        },
    });
    return { id: asset.id, url, localPath: relPath, provider: used };
}
//# sourceMappingURL=imageGenerator.js.map