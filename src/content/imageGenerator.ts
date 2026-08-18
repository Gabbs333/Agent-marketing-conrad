import { config } from "../config";
import { prisma } from "../db";
import { httpJson } from "../lib/http";
import { createPng, publicUrl, saveBuffer, slugify } from "../lib/files";
import type { GeneratedImage } from "../types";

/**
 * Générateur d'images multi-fournisseurs, dernière génération :
 *  - OpenAI (DALL·E / gpt-image) ;
 *  - Stability AI (SDXL) ;
 *  - Replicate (Flux, SDXL…) ;
 *  - fal.ai (Flux…) ;
 *  - Hugging Face Inference (Flux, SD…) ;
 *  - Together AI (Flux Schnell gratuit) ;
 *  - getimg.ai (SDXL) ;
 *  - endpoint local (AUTOMATIC1111 / ComfyUI) ;
 *  - mode démo (PNG généré localement, sans API).
 */

export type ImageProvider =
  | "auto"
  | "openai"
  | "stability"
  | "replicate"
  | "fal"
  | "huggingface"
  | "together"
  | "getimg"
  | "local";

function parseSize(size: string): [number, number] {
  const [w, h] = size.toLowerCase().split("x").map(Number);
  return [w || 1024, h || 1024];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function resolveProvider(): ImageProvider {
  if (config.openai.apiKey) return "openai";
  if (config.stability.apiKey) return "stability";
  if (config.replicate.apiToken) return "replicate";
  if (config.fal.apiKey) return "fal";
  if (config.huggingface.apiKey) return "huggingface";
  if (config.together.apiKey) return "together";
  if (config.getimg.apiKey) return "getimg";
  if (config.localImageEndpoint) return "local";
  return "auto";
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement de l'image échoué (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── OpenAI ───────────────────────────────────────────────────
async function openaiImage(prompt: string, size: string): Promise<Buffer> {
  const model = config.openai.imageModel;
  const body = (extra: Record<string, unknown>) =>
    JSON.stringify({ model, prompt, n: 1, size, ...extra });
  try {
    const data = await httpJson<{ data?: { b64_json?: string; url?: string }[] }>(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.openai.apiKey}` },
        body: body({ response_format: "b64_json" }),
      },
    );
    const b64 = data.data?.[0]?.b64_json;
    if (b64) return Buffer.from(b64, "base64");
    const url = data.data?.[0]?.url;
    if (url) return download(url);
    throw new Error("OpenAI n'a renvoyé aucune image");
  } catch (err) {
    const data = await httpJson<{ data?: { url?: string }[] }>(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.openai.apiKey}` },
        body: body({}),
      },
    );
    const url = data.data?.[0]?.url;
    if (url) return download(url);
    throw err;
  }
}

// ─── Stability AI (SDXL) ──────────────────────────────────────
async function stabilityImage(prompt: string, size: string): Promise<Buffer> {
  const [width, height] = parseSize(size);
  const res = await fetch(
    `https://api.stability.ai/v1/generation/${config.stability.engine}/text-to-image`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.stability.apiKey}`,
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
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Stability API ${res.status}: ${txt.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ─── Replicate (Flux, SDXL…) ──────────────────────────────────
async function replicateImage(prompt: string, size: string): Promise<Buffer> {
  const [width, height] = parseSize(size);
  const headers = { Authorization: `Bearer ${config.replicate.apiToken}`, "Content-Type": "application/json" };
  const model = config.image.replicateModel;
  const create = await httpJson<any>(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { prompt, width, height, num_outputs: 1 } }),
  });
  const getUrl: string | undefined = create.urls?.get;
  const outputUrl = extractOutputUrl(create.output);
  if (outputUrl) return download(outputUrl);
  if (!getUrl) throw new Error("Réponse Replicate inattendue");

  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const st = await httpJson<any>(getUrl, { headers });
    if (st.status === "succeeded") {
      const u = extractOutputUrl(st.output);
      if (u) return download(u);
      throw new Error("Replicate a réussi sans URL d'image");
    }
    if (st.status === "failed" || st.status === "canceled") {
      throw new Error(`Replicate a échoué : ${st.error ?? "raison inconnue"}`);
    }
  }
  throw new Error("Replicate : délai d'attente dépassé (2 min)");
}

function extractOutputUrl(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  const o = (Array.isArray(output) ? output[0] : output) as { url?: string } | undefined;
  return o?.url;
}

// ─── fal.ai (Flux…) ───────────────────────────────────────────
function falImageSize(size: string): string {
  const [w, h] = parseSize(size);
  if (w > h) return "landscape_4_3";
  if (h > w) return "portrait_4_3";
  return "square_hd";
}

async function falImage(prompt: string, size: string): Promise<Buffer> {
  const headers = { Authorization: `Key ${config.fal.apiKey}`, "Content-Type": "application/json" };
  const submit = await httpJson<any>(`https://queue.fal.run/${config.image.falModel}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, image_size: falImageSize(size) }),
  });
  const statusUrl: string | undefined = submit.status_url;
  if (!statusUrl) throw new Error("Réponse fal.ai inattendue");

  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const st = await httpJson<any>(statusUrl, { headers });
    if (st.status === "COMPLETED") {
      const u: string | undefined = st.images?.[0]?.url ?? st.response?.images?.[0]?.url;
      if (u) return download(u);
      throw new Error("fal.ai a terminé sans URL d'image");
    }
    if (st.status === "FAILED" || st.status === "ERROR") {
      throw new Error("fal.ai a échoué");
    }
  }
  throw new Error("fal.ai : délai d'attente dépassé (2 min)");
}

// ─── Hugging Face Inference (Flux, SD…) ───────────────────────
async function hfImage(prompt: string): Promise<Buffer> {
  const res = await fetch(`https://api-inference.huggingface.co/models/${config.image.hfModel}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.huggingface.apiKey}`,
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
async function togetherImage(prompt: string, size: string): Promise<Buffer> {
  const [width, height] = parseSize(size);
  const data = await httpJson<{ data?: { b64_json?: string }[] }>(
    "https://api.together.xyz/v1/images/generations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.together.apiKey}` },
      body: JSON.stringify({
        model: config.image.togetherModel,
        prompt,
        width,
        height,
        steps: 4,
        n: 1,
        response_format: "b64_json",
      }),
    },
  );
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("Together n'a renvoyé aucune image");
  return Buffer.from(b64, "base64");
}

// ─── getimg.ai (SDXL) ─────────────────────────────────────────
async function getimgImage(prompt: string, size: string): Promise<Buffer> {
  const [width, height] = parseSize(size);
  const data = await httpJson<{ image?: string }>(
    "https://api.getimg.ai/v1/stable-diffusion-xl/text-to-image",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.getimg.apiKey}` },
      body: JSON.stringify({
        model: config.image.getimgModel,
        prompt,
        width,
        height,
        output_format: "png",
        response_format: "b64",
      }),
    },
  );
  if (!data.image) throw new Error("getimg.ai n'a renvoyé aucune image");
  return Buffer.from(data.image, "base64");
}

// ─── Endpoint local (AUTOMATIC1111 / ComfyUI) ─────────────────
async function localImage(prompt: string, size: string): Promise<Buffer> {
  const [width, height] = parseSize(size);
  const data = await httpJson<{ images?: string[] }>(config.localImageEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps: 25, width, height }),
  });
  const b64 = data.images?.[0];
  if (!b64) throw new Error("Le générateur local n'a renvoyé aucune image");
  return Buffer.from(b64, "base64");
}

/** Image de démo : dégradé bleu nuit → doré, sans aucune API. */
function demoImage(size: string): Buffer {
  const [w, h] = parseSize(size);
  return createPng(w, h, (x, y) => {
    const t = y / h;
    const wave = Math.sin(x / 40) * 6;
    return [
      Math.round(16 + 30 * t),
      Math.round(42 + 34 * t),
      Math.round(58 + 120 * t + wave),
    ];
  });
}

export async function generateImage(input: {
  prompt: string;
  provider?: ImageProvider;
  size?: string;
  filename?: string;
}): Promise<GeneratedImage> {
  const provider = input.provider === "auto" ? resolveProvider() : (input.provider ?? resolveProvider());
  const size = input.size ?? "1024x1024";
  const filename = input.filename ?? `${slugify(input.prompt)}-${Date.now()}.png`;
  const relPath = `assets/images/${filename}`;

  let buf: Buffer;
  let used: string;

  if (config.demoMode) {
    buf = demoImage(size);
    used = "demo";
  } else if (provider === "openai" && config.openai.apiKey) {
    buf = await openaiImage(input.prompt, size);
    used = "openai";
  } else if (provider === "stability" && config.stability.apiKey) {
    buf = await stabilityImage(input.prompt, size);
    used = "stability";
  } else if (provider === "replicate" && config.replicate.apiToken) {
    buf = await replicateImage(input.prompt, size);
    used = "replicate";
  } else if (provider === "fal" && config.fal.apiKey) {
    buf = await falImage(input.prompt, size);
    used = "fal";
  } else if (provider === "huggingface" && config.huggingface.apiKey) {
    buf = await hfImage(input.prompt);
    used = "huggingface";
  } else if (provider === "together" && config.together.apiKey) {
    buf = await togetherImage(input.prompt, size);
    used = "together";
  } else if (provider === "getimg" && config.getimg.apiKey) {
    buf = await getimgImage(input.prompt, size);
    used = "getimg";
  } else if (provider === "local" && config.localImageEndpoint) {
    buf = await localImage(input.prompt, size);
    used = "local";
  } else {
    throw new Error(
      `Aucun générateur d'images configuré pour le provider « ${provider} ». ` +
        `Renseignez une clé (OPENAI_API_KEY, STABILITY_API_KEY, REPLICATE_API_TOKEN, FAL_KEY, HF_TOKEN, TOGETHER_API_KEY, GETIMG_API_KEY, LOCAL_IMAGE_ENDPOINT) ou laissez DEMO_MODE=true.`,
    );
  }

  await saveBuffer(buf, relPath);
  const url = publicUrl(relPath);
  const asset = await prisma.mediaAsset.create({
    data: {
      type: "image",
      url,
      localPath: relPath,
      tags: `prompt:${input.prompt.slice(0, 200)};provider:${used}`,
    },
  });
  return { id: asset.id, url, localPath: relPath, provider: used };
}
