import { config } from "../config";
import { httpJson } from "../lib/http";

/**
 * Couche LLM multi-fournisseurs (dernière génération) :
 *  - OpenAI, Anthropic (Claude), Google (Gemini) — APIs natives ;
 *  - Groq, Mistral, OpenRouter, DeepSeek, Together, LM Studio, vLLM,
 *    Ollama (mode HTTP) — APIs compatibles OpenAI ;
 *  - Ollama local — API native.
 *
 * Sélection par LLM_PROVIDER (ou « auto » : premier fournisseur configuré).
 */

export type LlmKind = "openai" | "anthropic" | "gemini" | "ollama";

export interface ResolvedLlm {
  kind: LlmKind;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  label: string;
}

const COMPAT_PROVIDERS: {
  name: string;
  key: string;
  baseUrl: string;
  defaultModel: string;
}[] = [
  { name: "groq", key: config.groq.apiKey, baseUrl: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-120b" },
  { name: "mistral", key: config.mistral.apiKey, baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest" },
  { name: "openrouter", key: config.openrouter.apiKey, baseUrl: "https://openrouter.ai/api/v1", defaultModel: "meta-llama/llama-3.3-70b-instruct" },
  { name: "deepseek", key: config.deepseek.apiKey, baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { name: "together", key: config.together.apiKey, baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
];

function pick(name: string): ResolvedLlm | null {
  const model = config.llm.model;
  if (name === "openai" && config.openai.apiKey) {
    return { kind: "openai", model: model || "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", apiKey: config.openai.apiKey, label: "OpenAI" };
  }
  if (name === "anthropic" && config.anthropic.apiKey) {
    return { kind: "anthropic", model: model || "claude-sonnet-4-5", apiKey: config.anthropic.apiKey, label: "Anthropic Claude" };
  }
  if (name === "gemini" && config.gemini.apiKey) {
    return { kind: "gemini", model: model || "gemini-2.0-flash", apiKey: config.gemini.apiKey, label: "Google Gemini" };
  }
  if (name === "ollama") {
    return { kind: "ollama", model: model || "llama3.1", baseUrl: config.ollama.baseUrl, label: "Ollama (local)" };
  }
  const compat = COMPAT_PROVIDERS.find((c) => c.name === name);
  if (compat?.key) {
    return { kind: "openai", model: model || compat.defaultModel, baseUrl: compat.baseUrl, apiKey: compat.key, label: compat.name };
  }
  return null;
}

/** Résout le fournisseur LLM actif selon la configuration. */
export function resolveLlm(): ResolvedLlm | null {
  const provider = config.llm.provider.toLowerCase();
  if (provider !== "auto") return pick(provider);

  for (const name of ["openai", "anthropic", "gemini", "groq", "mistral", "openrouter", "deepseek", "together"]) {
    const r = pick(name);
    if (r) return r;
  }
  // Endpoint OpenAI-compatible générique explicite (LM Studio, vLLM…)
  if (config.llm.baseUrl) {
    return {
      kind: "openai",
      model: config.llm.model || "local-model",
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      label: "endpoint OpenAI-compatible",
    };
  }
  // Ollama local en dernier recours
  return pick("ollama");
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callOpenAiCompatible(
  llm: ResolvedLlm,
  messages: ChatMessage[],
): Promise<string> {
  const data = await httpJson<{ choices?: { message?: { content?: string } }[] }>(
    `${llm.baseUrl!.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: llm.model, messages, temperature: 0.8 }),
    },
  );
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callAnthropic(llm: ResolvedLlm, messages: ChatMessage[]): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = messages.filter((m) => m.role !== "system");
  const data = await httpJson<{ content?: { type: string; text?: string }[] }>(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": llm.apiKey!,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: llm.model,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages: rest,
      }),
    },
  );
  return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
}

async function callGemini(llm: ResolvedLlm, messages: ChatMessage[]): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const rest = messages.filter((m) => m.role !== "system");
  const data = await httpJson<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
    `https://generativelanguage.googleapis.com/v1beta/models/${llm.model}:generateContent?key=${llm.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: rest.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      }),
    },
  );
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

async function callOllama(llm: ResolvedLlm, messages: ChatMessage[]): Promise<string> {
  const data = await httpJson<{ message?: { content?: string } }>(
    `${llm.baseUrl!.replace(/\/$/, "")}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: llm.model, messages, stream: false }),
    },
  );
  return data.message?.content?.trim() ?? "";
}

/**
 * Complète un texte via le LLM configuré.
 * Renvoie "" si aucun fournisseur n'est configuré ou en mode démo
 * (les gabarits intégrés prennent alors le relais).
 */
export async function completeText(prompt: string, system?: string): Promise<string> {
  if (config.demoMode) return "";
  const llm = resolveLlm();
  if (!llm) return "";
  const messages: ChatMessage[] = [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user", content: prompt },
  ];
  if (llm.kind === "anthropic") return callAnthropic(llm, messages);
  if (llm.kind === "gemini") return callGemini(llm, messages);
  if (llm.kind === "ollama") return callOllama(llm, messages);
  return callOpenAiCompatible(llm, messages);
}

/** Fournisseur LLM actif (pour l'affichage dans le dashboard/status). */
export function activeLlmLabel(): string | null {
  return resolveLlm()?.label ?? null;
}
