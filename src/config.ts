import "dotenv/config";
import type { Channel } from "./types";

function get(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: Number(get("PORT", "3000")),
  databaseUrl: get("DATABASE_URL"),
  demoMode: get("DEMO_MODE", "true").toLowerCase() === "true",

  hotel: {
    name: get("HOTEL_NAME", "Conrad Grand Luxury Hotel"),
    tagline: get("HOTEL_TAGLINE", "Le luxe à l'état pur"),
    website: get("HOTEL_WEBSITE", ""),
  },
  contentLanguage: get("CONTENT_LANGUAGE", "fr"),

  /** Authentification de l'API d'administration (header x-api-key ou Bearer). */
  auth: {
    adminApiKey: get("ADMIN_API_KEY"),
  },

  // ─── IA : LLM (textes) ─────────────────────────────────────
  llm: {
    provider: get("LLM_PROVIDER", "auto"),
    model: get("LLM_MODEL", ""), // vide = modèle par défaut du fournisseur choisi
    baseUrl: get("LLM_BASE_URL"),
    apiKey: get("LLM_API_KEY"),
  },
  openai: {
    apiKey: get("OPENAI_API_KEY"),
    model: get("LLM_MODEL", "gpt-4o-mini"),
    imageModel: get("IMAGE_MODEL", "dall-e-3"),
    ttsVoice: get("TTS_VOICE", "alloy"),
  },
  anthropic: { apiKey: get("ANTHROPIC_API_KEY") },
  gemini: { apiKey: get("GEMINI_API_KEY") },
  groq: { apiKey: get("GROQ_API_KEY") },
  mistral: { apiKey: get("MISTRAL_API_KEY") },
  openrouter: { apiKey: get("OPENROUTER_API_KEY") },
  deepseek: { apiKey: get("DEEPSEEK_API_KEY") },
  together: { apiKey: get("TOGETHER_API_KEY") },
  ollama: { baseUrl: get("OLLAMA_BASE_URL", "http://localhost:11434") },

  // ─── IA : images ───────────────────────────────────────────
  image: {
    provider: get("IMAGE_PROVIDER", "auto"),
    replicateModel: get("REPLICATE_IMAGE_MODEL", "black-forest-labs/flux-schnell"),
    falModel: get("FAL_IMAGE_MODEL", "fal-ai/flux/schnell"),
    hfModel: get("HF_IMAGE_MODEL", "black-forest-labs/FLUX.1-schnell"),
    togetherModel: get("TOGETHER_IMAGE_MODEL", "black-forest-labs/FLUX.1-schnell-Free"),
    getimgModel: get("GETIMG_MODEL", "stable-diffusion-xl"),
  },
  stability: {
    apiKey: get("STABILITY_API_KEY"),
    engine: get("STABILITY_ENGINE", "stable-diffusion-xl-1024-v1-0"),
  },
  replicate: { apiToken: get("REPLICATE_API_TOKEN") },
  fal: { apiKey: get("FAL_KEY") },
  huggingface: { apiKey: get("HF_TOKEN") },
  getimg: { apiKey: get("GETIMG_API_KEY") },
  localImageEndpoint: get("LOCAL_IMAGE_ENDPOINT"),

  // ─── IA : vidéo ────────────────────────────────────────────
  video: {
    provider: get("VIDEO_PROVIDER", "ffmpeg"),
    replicateModel: get("REPLICATE_VIDEO_MODEL", "wan-video/wan-2.2-5b"),
    falModel: get("FAL_VIDEO_MODEL", "fal-ai/wan/v2.2/5b/text-to-video"),
  },

  // ─── IA : voix off (TTS) ───────────────────────────────────
  tts: {
    provider: get("TTS_PROVIDER", "auto"), // auto | openai | groq | elevenlabs
    voice: get("TTS_VOICE", "hannah"),
    groqModel: get("TTS_GROQ_MODEL", "canopylabs/orpheus-v1-english"),
    elevenlabsVoiceId: get("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB"),
  },
  elevenlabs: { apiKey: get("ELEVENLABS_API_KEY") },

  // ─── Réseaux sociaux & publicité ───────────────────────────
  facebook: {
    pageId: get("FB_PAGE_ID"),
    pageToken: get("FB_PAGE_TOKEN"),
    appId: get("FB_APP_ID"),
    appSecret: get("FB_APP_SECRET"),
  },
  metaAds: {
    accessToken: get("META_ACCESS_TOKEN"),
    adAccountId: get("META_AD_ACCOUNT_ID"),
  },
  tiktok: {
    clientKey: get("TIKTOK_CLIENT_KEY"),
    clientSecret: get("TIKTOK_CLIENT_SECRET"),
    accessToken: get("TIKTOK_ACCESS_TOKEN"),
    identityId: get("TIKTOK_IDENTITY_ID"),
  },
  tiktokAds: {
    advertiserId: get("TIKTOK_ADVERTISER_ID"),
  },

  /** Webhooks Meta (WhatsApp Cloud API + Messenger). */
  webhook: {
    verifyToken: get("WEBHOOK_VERIFY_TOKEN"),
  },

  /** Routeur de cohabitation multi-agents sur le même numéro WhatsApp. */
  router: {
    receptionistWebhookUrl: get("RECEPTIONIST_WEBHOOK_URL"),
  },

  /** WhatsApp Business (Meta Cloud API). */
  whatsapp: {
    phoneNumberId: get("WHATSAPP_PHONE_NUMBER_ID"),
    accessToken: get("WHATSAPP_ACCESS_TOKEN") || get("META_ACCESS_TOKEN"),
    businessAccountId: get("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    templateWelcome: get("WHATSAPP_TEMPLATE_WELCOME", "hotel_welcome"),
    templateFollowup: get("WHATSAPP_TEMPLATE_FOLLOWUP", "hotel_followup"),
    templateOffer: get("WHATSAPP_TEMPLATE_OFFER", "hotel_offer"),
  },

  /** Messenger (Send API). */
  messenger: {
    pageId: get("FB_PAGE_ID"),
    pageToken: get("FB_PAGE_TOKEN"),
    verifyToken: get("MESSENGER_VERIFY_TOKEN") || get("WEBHOOK_VERIFY_TOKEN"),
  },

  email: {
    host: get("SMTP_HOST"),
    port: Number(get("SMTP_PORT", "587")),
    user: get("SMTP_USER"),
    pass: get("SMTP_PASSWORD"),
    from: get("EMAIL_FROM", "reservation@votre-hotel.com"),
  },

  /** Nurturing multicanal des leads. */
  nurture: {
    channels: get("NURTURE_CHANNELS", "email,whatsapp,messenger")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean) as Channel[],
    intervalHours: Number(get("NURTURE_INTERVAL_HOURS", "24")),
  },

  /** Relecture IA des brouillons avant publication. */
  review: {
    minScore: Number(get("REVIEW_MIN_SCORE", "40")),
  },
};
