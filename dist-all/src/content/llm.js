"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLlm = resolveLlm;
exports.completeText = completeText;
exports.activeLlmLabel = activeLlmLabel;
const config_1 = require("../config");
const http_1 = require("../lib/http");
const COMPAT_PROVIDERS = [
    { name: "groq", key: config_1.config.groq.apiKey, baseUrl: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-120b" },
    { name: "mistral", key: config_1.config.mistral.apiKey, baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest" },
    { name: "openrouter", key: config_1.config.openrouter.apiKey, baseUrl: "https://openrouter.ai/api/v1", defaultModel: "meta-llama/llama-3.3-70b-instruct" },
    { name: "deepseek", key: config_1.config.deepseek.apiKey, baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
    { name: "together", key: config_1.config.together.apiKey, baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
];
function pick(name) {
    const model = config_1.config.llm.model;
    if (name === "openai" && config_1.config.openai.apiKey) {
        return { kind: "openai", model: model || "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", apiKey: config_1.config.openai.apiKey, label: "OpenAI" };
    }
    if (name === "anthropic" && config_1.config.anthropic.apiKey) {
        return { kind: "anthropic", model: model || "claude-sonnet-4-5", apiKey: config_1.config.anthropic.apiKey, label: "Anthropic Claude" };
    }
    if (name === "gemini" && config_1.config.gemini.apiKey) {
        return { kind: "gemini", model: model || "gemini-2.0-flash", apiKey: config_1.config.gemini.apiKey, label: "Google Gemini" };
    }
    if (name === "ollama") {
        return { kind: "ollama", model: model || "llama3.1", baseUrl: config_1.config.ollama.baseUrl, label: "Ollama (local)" };
    }
    const compat = COMPAT_PROVIDERS.find((c) => c.name === name);
    if (compat?.key) {
        return { kind: "openai", model: model || compat.defaultModel, baseUrl: compat.baseUrl, apiKey: compat.key, label: compat.name };
    }
    return null;
}
/** Résout le fournisseur LLM actif selon la configuration. */
function resolveLlm() {
    const provider = config_1.config.llm.provider.toLowerCase();
    if (provider !== "auto")
        return pick(provider);
    for (const name of ["openai", "anthropic", "gemini", "groq", "mistral", "openrouter", "deepseek", "together"]) {
        const r = pick(name);
        if (r)
            return r;
    }
    // Endpoint OpenAI-compatible générique explicite (LM Studio, vLLM…)
    if (config_1.config.llm.baseUrl) {
        return {
            kind: "openai",
            model: config_1.config.llm.model || "local-model",
            baseUrl: config_1.config.llm.baseUrl,
            apiKey: config_1.config.llm.apiKey,
            label: "endpoint OpenAI-compatible",
        };
    }
    // Ollama local en dernier recours
    return pick("ollama");
}
async function callOpenAiCompatible(llm, messages) {
    const data = await (0, http_1.httpJson)(`${llm.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: llm.model, messages, temperature: 0.8 }),
    });
    return data.choices?.[0]?.message?.content?.trim() ?? "";
}
async function callAnthropic(llm, messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = messages.filter((m) => m.role !== "system");
    const data = await (0, http_1.httpJson)("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": llm.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: llm.model,
            max_tokens: 1024,
            ...(system ? { system } : {}),
            messages: rest,
        }),
    });
    return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
}
async function callGemini(llm, messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = messages.filter((m) => m.role !== "system");
    const data = await (0, http_1.httpJson)(`https://generativelanguage.googleapis.com/v1beta/models/${llm.model}:generateContent?key=${llm.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents: rest.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        }),
    });
    return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}
async function callOllama(llm, messages) {
    const data = await (0, http_1.httpJson)(`${llm.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: llm.model, messages, stream: false }),
    });
    return data.message?.content?.trim() ?? "";
}
/**
 * Complète un texte via le LLM configuré.
 * Renvoie "" si aucun fournisseur n'est configuré ou en mode démo
 * (les gabarits intégrés prennent alors le relais).
 */
async function completeText(prompt, system) {
    if (config_1.config.demoMode)
        return "";
    const llm = resolveLlm();
    if (!llm)
        return "";
    const messages = [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: prompt },
    ];
    if (llm.kind === "anthropic")
        return callAnthropic(llm, messages);
    if (llm.kind === "gemini")
        return callGemini(llm, messages);
    if (llm.kind === "ollama")
        return callOllama(llm, messages);
    return callOpenAiCompatible(llm, messages);
}
/** Fournisseur LLM actif (pour l'affichage dans le dashboard/status). */
function activeLlmLabel() {
    return resolveLlm()?.label ?? null;
}
//# sourceMappingURL=llm.js.map