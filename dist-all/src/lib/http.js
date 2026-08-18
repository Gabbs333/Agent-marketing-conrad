"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.httpJson = httpJson;
class HttpError extends Error {
    status;
    body;
    url;
    constructor(status, body, url) {
        super(`HTTP ${status} sur ${url}: ${format(body)}`);
        this.status = status;
        this.body = body;
        this.url = url;
    }
}
exports.HttpError = HttpError;
function format(body) {
    if (typeof body === "string")
        return body.slice(0, 400);
    try {
        return JSON.stringify(body).slice(0, 400);
    }
    catch {
        return String(body);
    }
}
/**
 * Requête fetch + parsing JSON avec gestion d'erreur lisible.
 * Applique un timeout de 120 s par défaut (annulable via `signal`).
 */
async function httpJson(url, options = {}) {
    const signal = options.signal ?? AbortSignal.timeout(120_000);
    const res = await fetch(url, { ...options, signal });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    }
    catch {
        data = text;
    }
    if (!res.ok)
        throw new HttpError(res.status, data, url);
    return data;
}
//# sourceMappingURL=http.js.map