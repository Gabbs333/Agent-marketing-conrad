"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTts = resolveTts;
exports.ttsAvailable = ttsAvailable;
exports.textToSpeech = textToSpeech;
const config_1 = require("../config");
const files_1 = require("../lib/files");
function resolveTts() {
    const v = (config_1.config.tts.voice ?? "").toLowerCase();
    const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
    const GROQ_VOICES = ["hannah", "troy", "austin", "mia", "zoe", "tara", "leo", "dan", "jess", "leah", "zac"];
    const candidates = [
        {
            provider: "openai",
            voice: OPENAI_VOICES.includes(v) ? v : "alloy",
            key: config_1.config.openai.apiKey,
        },
        {
            provider: "groq",
            voice: GROQ_VOICES.includes(v) ? v : "hannah",
            key: config_1.config.groq.apiKey,
        },
        {
            provider: "elevenlabs",
            voice: config_1.config.tts.elevenlabsVoiceId,
            key: config_1.config.elevenlabs.apiKey,
        },
    ];
    const provider = config_1.config.tts.provider.toLowerCase();
    if (provider !== "auto") {
        const c = candidates.find((x) => x.provider === provider);
        return c?.key ? c : null;
    }
    for (const c of candidates) {
        if (c.key)
            return c;
    }
    return null;
}
/** Vrai si une voix off peut être générée (fournisseur configuré, hors mode démo). */
function ttsAvailable() {
    return !config_1.config.demoMode && resolveTts() !== null;
}
/** Génère la voix off d'un texte et l'enregistre dans assets/audio/. */
async function textToSpeech(text, opts = {}) {
    if (config_1.config.demoMode)
        return null;
    const tts = resolveTts();
    if (!tts)
        return null;
    let res;
    let ext;
    if (tts.provider === "openai") {
        res = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tts.key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "tts-1",
                voice: tts.voice,
                input: text.slice(0, 4000),
                response_format: "mp3",
            }),
        });
        ext = "mp3";
    }
    else if (tts.provider === "groq") {
        res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tts.key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: config_1.config.tts.groqModel,
                voice: tts.voice,
                input: text.slice(0, 4000),
                response_format: "wav",
            }),
        });
        ext = "wav";
    }
    else {
        res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${tts.voice}`, {
            method: "POST",
            headers: {
                "xi-api-key": tts.key,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
            },
            body: JSON.stringify({
                text: text.slice(0, 4000),
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
        });
        ext = "mp3";
    }
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`TTS ${tts.provider} ${res.status}: ${body.slice(0, 200)}`);
    }
    const filename = opts.filename ?? `tts-${Date.now()}.${ext}`;
    const path = await (0, files_1.saveBuffer)(Buffer.from(await res.arrayBuffer()), `assets/audio/${filename}`);
    return { path, provider: tts.provider };
}
//# sourceMappingURL=tts.js.map