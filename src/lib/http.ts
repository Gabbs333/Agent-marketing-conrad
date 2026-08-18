export class HttpError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public url: string,
  ) {
    super(`HTTP ${status} sur ${url}: ${format(body)}`);
  }
}

function format(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 400);
  try {
    return JSON.stringify(body).slice(0, 400);
  } catch {
    return String(body);
  }
}

/**
 * Requête fetch + parsing JSON avec gestion d'erreur lisible.
 * Applique un timeout de 120 s par défaut (annulable via `signal`).
 */
export async function httpJson<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const signal = options.signal ?? AbortSignal.timeout(120_000);
  const res = await fetch(url, { ...options, signal });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new HttpError(res.status, data, url);
  return data as T;
}
