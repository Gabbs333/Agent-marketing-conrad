"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ttsAvailable = exports.textToSpeech = void 0;
exports.hasFfmpeg = hasFfmpeg;
exports.buildSrt = buildSrt;
exports.createSlideshow = createSlideshow;
exports.addAudioAndSubtitles = addAudioAndSubtitles;
exports.generateVideoFromScript = generateVideoFromScript;
exports.generateAiVideo = generateAiVideo;
exports.generateCampaignVideo = generateCampaignVideo;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_util_1 = require("node:util");
const config_1 = require("../config");
const db_1 = require("../db");
const http_1 = require("../lib/http");
const files_1 = require("../lib/files");
const tts_1 = require("./tts");
/**
 * Générateur de vidéos basé sur ffmpeg :
 *  - diaporama avec effet Ken Burns (zoom progressif) et transitions en fondu ;
 *  - voix off IA scène par scène (OpenAI / Groq / ElevenLabs via src/content/tts.ts),
 *    chaque narration étant synchronisée sur la durée exacte de sa scène ;
 *  - sous-titres incrustés (SRT) alignés sur la voix off ;
 *  - assemblage final (audio + sous-titres).
 */
const execFileP = (0, node_util_1.promisify)(node_child_process_1.execFile);
/** Ré-export du TTS multi-fournisseurs (compatibilité + usage externe). */
var tts_2 = require("./tts");
Object.defineProperty(exports, "textToSpeech", { enumerable: true, get: function () { return tts_2.textToSpeech; } });
Object.defineProperty(exports, "ttsAvailable", { enumerable: true, get: function () { return tts_2.ttsAvailable; } });
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
/** Durée (secondes) d'un fichier audio, lue dans la sortie de `ffmpeg -i` (pas besoin de ffprobe). */
async function audioDuration(path) {
    try {
        await execFileP("ffmpeg", ["-hide_banner", "-i", path]);
    }
    catch (err) {
        const stderr = String(err?.stderr ?? err?.message ?? "");
        const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m)
            return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    throw new Error(`Impossible de déterminer la durée audio de ${path}`);
}
const round1 = (n) => Math.round(n * 10) / 10;
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
/**
 * Diaporama Ken Burns avec transitions en fondu (xfade) entre les images.
 * La durée totale de sortie = somme des durées − (n−1) × fondu.
 */
async function createSlideshow(input) {
    if (!input.images.length)
        throw new Error("Aucune image fournie pour la vidéo");
    const { width = 1280, height = 720 } = input;
    const fps = 25;
    const durations = input.durations ?? input.images.map(() => 4);
    const fade = Math.min(input.crossfadeSec ?? 0.4, ...durations.map((d) => d / 2), 1);
    const parts = [];
    const zooms = [];
    for (let i = 0; i < input.images.length; i++) {
        // Marge = fade : le flux doit couvrir toute la durée de sa scène + transition
        parts.push("-loop", "1", "-framerate", String(fps), "-t", String(durations[i] + fade), "-i", input.images[i]);
        zooms.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(zoom+0.0015,1.5)':d=1:fps=${fps}:s=${width}x${height}[v${i}]`);
    }
    let filterComplex;
    let outLabel;
    if (input.images.length === 1) {
        filterComplex = zooms[0];
        outLabel = "[v0]";
    }
    else {
        // Chaîne xfade : le début de la transition i se situe à somme(d0..d(i−1)) − i×fade
        const xfades = [];
        let prev = "[v0]";
        let offset = 0;
        for (let i = 1; i < input.images.length; i++) {
            offset += durations[i - 1];
            const start = Math.max(0, round1(offset - i * fade));
            xfades.push(`${prev}[v${i}]xfade=transition=fade:duration=${round1(fade)}:offset=${start.toFixed(3)}[x${i}]`);
            prev = `[x${i}]`;
        }
        filterComplex = `${zooms.join(";")};${xfades.join(";")}`;
        outLabel = `[x${input.images.length - 1}]`;
    }
    const outPath = `assets/videos/${input.outputName}`;
    await ffmpeg([
        ...parts,
        "-filter_complex",
        filterComplex,
        "-map",
        outLabel,
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
// ──────────────────────────────────────────────────────────────
// Voix off scène par scène : chaque narration est générée, mesurée,
// puis calée (silence initial + remplissage) sur la durée de sa scène.
// ──────────────────────────────────────────────────────────────
/** Silence avant la narration d'une scène (souffle visuel). */
const VO_PAD_BEFORE = 0.45;
/** Silence après la narration (respiration avant la transition). */
const VO_PAD_AFTER = 0.55;
/** Calle une narration sur la durée exacte de sa scène (silence avant + après). */
async function makeVoiceChunk(src, durationSec, outRel) {
    await ffmpeg([
        "-i",
        src,
        "-af",
        `adelay=delays=${Math.round(VO_PAD_BEFORE * 1000)}:all=1,apad`,
        "-t",
        durationSec.toFixed(2),
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        "-y",
        (0, files_1.assetPath)(outRel),
    ]);
    return outRel;
}
/** Piste silencieuse pour une scène sans narration. */
async function makeSilenceChunk(durationSec, outRel) {
    await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=stereo",
        "-t",
        durationSec.toFixed(2),
        "-c:a",
        "pcm_s16le",
        "-y",
        (0, files_1.assetPath)(outRel),
    ]);
    return outRel;
}
/** Concatène les chunks audio (même format : pcm 44,1 kHz stéréo). */
async function concatAudioChunks(chunks, outRel) {
    const outAbs = (0, files_1.assetPath)(outRel);
    if (chunks.length === 1) {
        await (0, promises_1.copyFile)((0, files_1.assetPath)(chunks[0]), outAbs);
        return outRel;
    }
    await ffmpeg([
        ...chunks.flatMap((c) => ["-i", (0, files_1.assetPath)(c)]),
        "-filter_complex",
        `${chunks.map((_, i) => `[${i}:a]`).join("")}concat=n=${chunks.length}:v=0:a=1[outa]`,
        "-map",
        "[outa]",
        "-c:a",
        "pcm_s16le",
        "-y",
        outAbs,
    ]);
    return outRel;
}
/** Décode le script en segments montables (hook, scènes, CTA). */
function buildSegments(script, images) {
    const scenes = script.scenes.length
        ? script.scenes
        : [{ visual: "", narration: script.title, durationSec: 4 }];
    const img = (i) => images[i % images.length];
    const segments = [];
    if (script.hook?.trim()) {
        segments.push({ text: script.hook.trim(), imagePath: img(0), minDuration: 2.5 });
    }
    scenes.forEach((s, i) => segments.push({
        text: (s.narration ?? "").trim(),
        imagePath: img(i),
        minDuration: Math.max(2, Math.round(s.durationSec || 4)),
    }));
    if (script.cta?.trim()) {
        segments.push({ text: script.cta.trim(), imagePath: img(images.length - 1), minDuration: 2.5 });
    }
    return segments;
}
/**
 * Pipeline complet : script → voix off scène par scène → diaporama
 * (fondu enchaîné) → sous-titres synchronisés → vidéo finale.
 *
 * `withVoice` (défaut : auto) active la voix off dès qu'un fournisseur
 * TTS est configuré. Chaque scène dure au moins le temps de sa narration.
 */
async function generateVideoFromScript(input) {
    if (!(await hasFfmpeg())) {
        throw new Error("ffmpeg n'est pas installé. Installez-le pour générer des vidéos (ex. : brew install ffmpeg).");
    }
    if (!input.images.length)
        throw new Error("Au moins une image est nécessaire pour la vidéo");
    const { script } = input;
    const name = input.outputName ?? `video-${(0, files_1.slugify)(script.title)}-${Date.now()}.mp4`;
    const baseName = name.replace(/\.mp4$/i, "");
    const segments = buildSegments(script, input.images);
    // ── Résolution de la voix off ──
    const explicitVoice = input.withVoice === true;
    const voiceWanted = input.withVoice ?? (0, tts_1.ttsAvailable)();
    let voice = voiceWanted;
    if (voiceWanted && !(0, tts_1.ttsAvailable)()) {
        if (explicitVoice) {
            throw new Error("Voix off demandée mais aucun fournisseur TTS n'est configuré (TTS_PROVIDER, GROQ_API_KEY, OPENAI_API_KEY ou ELEVENLABS_API_KEY).");
        }
        voice = false;
    }
    if (voice) {
        try {
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                if (!seg.text)
                    continue;
                const res = await (0, tts_1.textToSpeech)(seg.text, { filename: `${baseName}-vo-${i}.wav` });
                if (!res) {
                    // Fournisseur disparu en cours de route (ex. clé absente)
                    if (explicitVoice)
                        throw new Error("Voix off demandée mais aucun fournisseur TTS disponible.");
                    voice = false;
                    break;
                }
                seg.voiceFile = res.path;
                seg.audioDuration = await audioDuration(res.path);
            }
        }
        catch (err) {
            if (explicitVoice)
                throw err;
            console.error("[video] Voix off indisponible, montage sans narration :", err);
            voice = false;
        }
    }
    if (!voice)
        segments.forEach((s) => ((s.voiceFile = undefined), (s.audioDuration = undefined)));
    // ── Durées des scènes (la narration pilote la durée) ──
    const durations = segments.map((seg) => {
        if (voice && seg.voiceFile && seg.audioDuration != null) {
            return Math.max(seg.minDuration, round1(seg.audioDuration + VO_PAD_BEFORE + VO_PAD_AFTER));
        }
        return seg.minDuration;
    });
    const fade = Math.min(0.4, ...durations.map((d) => d / 2), 1);
    // Compense les fondus enchaînés : la dernière scène absorbe le temps perdu
    // pour que piste audio et vidéo finissent exactement ensemble.
    durations[durations.length - 1] += round1((segments.length - 1) * fade);
    // ── 1. Diaporama Ken Burns + fondus enchaînés ──
    const slideshowPath = await createSlideshow({
        images: segments.map((s) => s.imagePath),
        durations,
        outputName: `${baseName}-slides.mp4`,
        crossfadeSec: fade,
    });
    // ── 2. Piste audio : chaque narration calée sur sa scène ──
    let audioPath = null;
    if (voice) {
        const chunks = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            chunks.push(seg.voiceFile
                ? await makeVoiceChunk(seg.voiceFile, durations[i], `${baseName}-vo-chunk-${i}.wav`)
                : await makeSilenceChunk(durations[i], `${baseName}-vo-chunk-${i}.wav`));
        }
        audioPath = await concatAudioChunks(chunks, `${baseName}-vo.wav`);
    }
    // ── 3. Sous-titres synchronisés (alignés sur la voix off) ──
    const srtSegments = [];
    let cursor = 0;
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.text) {
            const start = voice && seg.audioDuration != null ? cursor + VO_PAD_BEFORE : cursor;
            const end = voice && seg.audioDuration != null ? start + seg.audioDuration : cursor + durations[i];
            srtSegments.push({ text: seg.text, startSec: round1(start), endSec: round1(end) });
        }
        cursor += durations[i];
    }
    const srtPath = await (0, files_1.saveText)(buildSrt(srtSegments), `assets/videos/${baseName}.srt`);
    // ── 4. Assemblage final ──
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
            tags: `title:${script.title.slice(0, 120)};generated;voiceover`,
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
 *  - VIDEO_PROVIDER=ffmpeg : diaporama Ken Burns + fondus + voix off + sous-titres (local, défaut) ;
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