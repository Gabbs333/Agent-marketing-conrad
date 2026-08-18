import { config } from "../config";
import { saveBuffer } from "../lib/files";

/**
 * Voix off (TTS) multi-fournisseurs :
 *  - OpenAI (tts-1) ;
 *  - Groq (playai-tts — gratuit avec la clé Groq) ;
 *  - ElevenLabs (qualité studio).
 * Sélection par TTS_PROVIDER (ou « auto » : premier fournisseur configuré).
 */

export type TtsProvider = "openai" | "groq" | "elevenlabs";

export interface ResolvedTts {
  provider: TtsProvider;
  voice: string;
  key: string;
}

export function resolveTts(): ResolvedTts | null {
  const v = (config.tts.voice ?? "").toLowerCase();
  const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
  const GROQ_VOICES = ["hannah", "troy", "austin", "mia", "zoe", "tara", "leo", "dan", "jess", "leah", "zac"];
  const candidates: ResolvedTts[] = [
    {
      provider: "openai",
      voice: OPENAI_VOICES.includes(v) ? v : "alloy",
      key: config.openai.apiKey,
    },
    {
      provider: "groq",
      voice: GROQ_VOICES.includes(v) ? v : "hannah",
      key: config.groq.apiKey,
    },
    {
      provider: "elevenlabs",
      voice: config.tts.elevenlabsVoiceId,
      key: config.elevenlabs.apiKey,
    },
  ];

  const provider = config.tts.provider.toLowerCase();
  if (provider !== "auto") {
    const c = candidates.find((x) => x.provider === provider);
    return c?.key ? c : null;
  }
  for (const c of candidates) {
    if (c.key) return c;
  }
  return null;
}

/** Vrai si une voix off peut être générée (fournisseur configuré, hors mode démo). */
export function ttsAvailable(): boolean {
  return !config.demoMode && resolveTts() !== null;
}

export interface TtsResult {
  path: string;
  provider: TtsProvider;
}

/** Génère la voix off d'un texte et l'enregistre dans assets/audio/. */
export async function textToSpeech(
  text: string,
  opts: { filename?: string } = {},
): Promise<TtsResult | null> {
  if (config.demoMode) return null;
  const tts = resolveTts();
  if (!tts) return null;

  let res: Response;
  let ext: string;

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
  } else if (tts.provider === "groq") {
    res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tts.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.tts.groqModel,
        voice: tts.voice,
        input: text.slice(0, 4000),
        response_format: "wav",
      }),
    });
    ext = "wav";
  } else {
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
  const path = await saveBuffer(Buffer.from(await res.arrayBuffer()), `assets/audio/${filename}`);
  return { path, provider: tts.provider };
}
