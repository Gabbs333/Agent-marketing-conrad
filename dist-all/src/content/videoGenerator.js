"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasFfmpeg = hasFfmpeg;
exports.buildSrt = buildSrt;
exports.textToSpeech = textToSpeech;
exports.createSlideshow = createSlideshow;
exports.addAudioAndSubtitles = addAudioAndSubtitles;
exports.generateVideoFromScript = generateVideoFromScript;
exports.generateAiVideo = generateAiVideo;
exports.generateCampaignVideo = generateCampaignVideo;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const config_1 = require("../config");
const db_1 = require("../db");
const http_1 = require("../lib/http");
const files_1 = require("../lib/files");
/**
 * Générateur de vidéos basé sur ffmpeg :
 *  - diaporama avec effet Ken Burns (zoom progressif) à partir d'images ;
 *  - voix off IA (OpenAI TTS) ;
 *  - sous-titres incrustés (SRT) ;
 *  - assemblage final (audio + sous-titres).
 */
const execFileP = (0, node_util_1.promisify)(node_child_process_1.execFile);
let ffmpegAvailable = null;
async function hasFfmpeg() {
    if (ffmpegAvailable !== null)
        return ffmpegAvailable;
    try {
        await execFileP("ffmpeg", ["-version"]);
        ffmpegAvailable = true;
    }
    catch {
        ffmpegAvailable = false;
    }
    return ffmpegAvailable;
}
async function ffmpeg(args) {
    try {
        await execFileP("ffmpeg", args, { maxBuffer: 20 * 1024 * 1024 });
    }
    catch (err) {
        const detail = err?.stderr ?? err?.message ?? String(err);
        throw new Error(`ffmpeg a échoué : ${String(detail).slice(-1500)}`);
    }
}
/** Échappe un chemin pour le filtre `subtitles` de ffmpeg. */
function escapeFilterPath(p) {
    return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
function fmtSrtTime(sec) {
    const ms = Math.round(sec * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const milli = ms % 1000;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)},${String(milli).padStart(3, "0")}`;
}
function buildSrt(segments) {
    return segments
        .map((seg, i) => `${i + 1}\n${fmtSrtTime(seg.startSec)} --> ${fmtSrtTime(seg.endSec)}\n${seg.text}\n`)
        .join("\n");
}
/** Voix off via OpenAI TTS. Renvoie null si non configurée (mode démo). */
async function textToSpeech(text, opts = {}) {
    if (config_1.config.demoMode || !config_1.config.openai.apiKey)
        return null;
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${config_1.config.openai.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "tts-1",
            voice: opts.voice ?? config_1.config.openai.ttsVoice,
            input: text.slice(0, 4000),
        }),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`TTS OpenAI ${res.status}: ${txt.slice(0, 200)}`);
    }
    const filename = opts.filename ?? `tts-${Date.now()}.mp3`;
    return (0, files_1.saveBuffer)(Buffer.from(await res.arrayBuffer()), `assets/audio/${filename}`);
}
/** Diaporama Ken Burns à partir d'images (une durée par image possible). */
async function createSlideshow(input) {
    if (!input.images.length)
        throw new Error("Aucune image fournie pour la vidéo");
    const { width = 1280, height = 720 } = input;
    const fps = 25;
    const durations = input.durations ?? input.images.map(() => 4);
    const parts = [];
    const filters = [];
    for (let i = 0; i < input.images.length; i++) {
        parts.push("-loop", "1", "-framerate", String(fps), "-t", String(durations[i]), "-i", input.images[i]);
        filters.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(zoom+0.0015,1.5)':d=1:fps=${fps}:s=${width}x${height}[v${i}]`);
    }
    const concat = `${filters.map((_, i) => `[v${i}]`).join("")}concat=n=${input.images.length}:v=1:a=0[outv]`;
    const outPath = `assets/videos/${input.outputName}`;
    await ffmpeg([
        ...parts,
        "-filter_complex",
        `${filters.join(";")};${concat}`,
        "-map",
        "[outv]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        outPath,
    ]);
    return outPath;
}
/** Ajoute la voix off et incruste les sous-titres sur une vidéo existante. */
async function addAudioAndSubtitles(input) {
    const args = ["-i", input.videoPath];
    if (input.audioPath)
        args.push("-i", input.audioPath);
    const vf = input.srtPath
        ? `subtitles='${escapeFilterPath((0, files_1.assetPath)(input.srtPath))}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1,MarginV=40'`
        : "null";
    const outPath = `assets/videos/${input.outputName}`;
    args.push("-vf", vf, "-map", "0:v:0");
    if (input.audioPath)
        args.push("-map", "1:a:0");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", outPath);
    await ffmpeg(args);
    return outPath;
}
/**
 * Pipeline complet : script → voix off → diaporama → sous-titres → vidéo finale.
 * Les images sont cyclées si moins nombreuses que les scènes.
 */
async function generateVideoFromScript(input) {
    if (!(await hasFfmpeg())) {
        throw new Error("ffmpeg n'est pas installé. Installez-le pour générer des vidéos (ex. : brew install ffmpeg).");
    }
    if (!input.images.length)
        throw new Error("Au moins une image est nécessaire pour la vidéo");
    const { script } = input;
    const scenes = script.scenes.length ? script.scenes : [{ visual: "", narration: script.title, durationSec: 4 }];
    const images = scenes.map((_, i) => input.images[i % input.images.length]);
    const durations = scenes.map((s) => Math.max(2, Math.round(s.durationSec || 4)));
    const name = input.outputName ?? `video-${(0, files_1.slugify)(script.title)}-${Date.now()}.mp4`;
    const baseName = name.replace(/\.mp4$/i, "");
    // 1. Diaporama
    const slideshowPath = await createSlideshow({
        images,
        durations,
        outputName: `${baseName}-slides.mp4`,
    });
    // 2. Voix off
    const narration = [script.hook, ...scenes.map((s) => s.narration), script.cta]
        .filter(Boolean)
        .join(" ");
    let audioPath = null;
    if (input.withVoice) {
        audioPath = await textToSpeech(narration, { filename: `${baseName}-vo.mp3` });
    }
    // 3. Sous-titres (hook + scènes, timings cumulés)
    const segments = [];
    let cursor = 0;
    if (script.hook) {
        const d = 2.5;
        segments.push({ text: script.hook, startSec: cursor, endSec: cursor + d });
        cursor += d;
    }
    for (const s of scenes) {
        const d = Math.max(2, Math.round(s.durationSec || 4));
        segments.push({ text: s.narration, startSec: cursor, endSec: cursor + d });
        cursor += d;
    }
    if (script.cta) {
        segments.push({ text: script.cta, startSec: cursor, endSec: cursor + 2.5 });
    }
    const srtPath = await (0, files_1.saveText)(buildSrt(segments), `assets/videos/${baseName}.srt`);
    // 4. Assemblage final
    const finalPath = await addAudioAndSubtitles({
        videoPath: slideshowPath,
        outputName: name,
        audioPath,
        srtPath,
    });
    const url = (0, files_1.publicUrl)(finalPath);
    const asset = await db_1.prisma.mediaAsset.create({
        data: {
            type: "video",
            url,
            localPath: finalPath,
            tags: `title:${script.title.slice(0, 120)};generated`,
        },
    });
    return { id: asset.id, url, localPath: finalPath, script };
}
// ──────────────────────────────────────────────────────────────
// Vidéo par IA (dernière génération open source)
// Replicate : Wan 2.2, HunyuanVideo, Mochi…
// fal.ai     : wan/v2.2, hunyuan, mochi…
// ──────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function downloadVideo(url) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Téléchargement de la vidéo échoué (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
}
async function replicateVideo(prompt) {
    const headers = { Authorization: `Bearer ${config_1.config.replicate.apiToken}`, "Content-Type": "application/json" };
    const model = config_1.config.video.replicateModel;
    const create = await (0, http_1.httpJson)(`https://api.replicate.com/v1/models/${model}/predictions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: { prompt } }),
    });
    const getUrl = create.urls?.get;
    if (typeof create.output === "string" && create.output.startsWith("http")) {
        return downloadVideo(create.output);
    }
    if (!getUrl)
        throw new Error("Réponse Replicate vidéo inattendue");
    for (let i = 0; i < 90; i++) {
        await sleep(3000);
        const st = await (0, http_1.httpJson)(getUrl, { headers });
        if (st.status === "succeeded") {
            const out = Array.isArray(st.output) ? st.output[0] : st.output;
            const u = typeof out === "string" ? out : out?.url ?? out?.video;
            if (typeof u === "string")
                return downloadVideo(u);
            throw new Error("Replicate a réussi sans URL vidéo");
        }
        if (st.status === "failed" || st.status === "canceled") {
            throw new Error(`Replicate vidéo a échoué : ${st.error ?? "raison inconnue"}`);
        }
    }
    throw new Error("Replicate vidéo : délai d'attente dépassé (4 min)");
}
async function falVideo(prompt) {
    const headers = { Authorization: `Key ${config_1.config.fal.apiKey}`, "Content-Type": "application/json" };
    const submit = await (0, http_1.httpJson)(`https://queue.fal.run/${config_1.config.video.falModel}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt }),
    });
    const statusUrl = submit.status_url;
    if (!statusUrl)
        throw new Error("Réponse fal.ai vidéo inattendue");
    for (let i = 0; i < 90; i++) {
        await sleep(3000);
        const st = await (0, http_1.httpJson)(statusUrl, { headers });
        if (st.status === "COMPLETED") {
            const u = st.video?.url ?? st.response?.video?.url ?? st.media?.url;
            if (u)
                return downloadVideo(u);
            throw new Error("fal.ai a terminé sans URL vidéo");
        }
        if (st.status === "FAILED" || st.status === "ERROR")
            throw new Error("fal.ai vidéo a échoué");
    }
    throw new Error("fal.ai vidéo : délai d'attente dépassé (4 min)");
}
/** Génère une vidéo par IA (text-to-video) et l'indexe dans la médiathèque. */
async function generateAiVideo(input) {
    const provider = input.provider ?? config_1.config.video.provider;
    let buf;
    let used;
    if (provider === "fal" && config_1.config.fal.apiKey) {
        buf = await falVideo(input.prompt);
        used = "fal";
    }
    else if (config_1.config.replicate.apiToken) {
        buf = await replicateVideo(input.prompt);
        used = "replicate";
    }
    else {
        throw new Error("Aucun générateur vidéo IA configuré : renseignez REPLICATE_API_TOKEN (VIDEO_PROVIDER=replicate) ou FAL_KEY (VIDEO_PROVIDER=fal).");
    }
    const name = input.outputName ?? `video-ai-${Date.now()}.mp4`;
    const relPath = await (0, files_1.saveBuffer)(buf, `assets/videos/${name}`);
    const url = (0, files_1.publicUrl)(relPath);
    const asset = await db_1.prisma.mediaAsset.create({
        data: {
            type: "video",
            url,
            localPath: relPath,
            tags: `prompt:${input.prompt.slice(0, 200)};provider:${used};ai-generated`,
        },
    });
    return { id: asset.id, url, localPath: relPath };
}
/**
 * Dispatcheur de génération vidéo d'une campagne :
 *  - VIDEO_PROVIDER=ffmpeg : diaporama Ken Burns + sous-titres (local, défaut) ;
 *  - replicate / fal      : vidéo IA text-to-video ;
 *  - ai                   : tente l'IA puis se replie sur ffmpeg.
 */
async function generateCampaignVideo(input) {
    const mode = input.mode ?? config_1.config.video.provider;
    const prompt = [input.script.hook, ...input.script.scenes.map((s) => s.visual), input.script.cta]
        .filter(Boolean)
        .join(" — ");
    if (mode === "replicate" || mode === "fal" || mode === "ai") {
        const provider = mode === "fal" ? "fal" : mode === "replicate" ? "replicate" : undefined;
        try {
            return await generateAiVideo({ prompt, provider, outputName: input.outputName });
        }
        catch (err) {
            if (mode !== "ai")
                throw err;
            console.error("[video] IA indisponible, repli sur ffmpeg :", err);
        }
    }
    return generateVideoFromScript({
        script: input.script,
        images: input.images,
        outputName: input.outputName,
        withVoice: input.withVoice,
    });
}
//# sourceMappingURL=videoGenerator.js.map