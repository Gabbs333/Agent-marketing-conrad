import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config";

/**
 * Authentification par clé API sur l'ensemble de l'API d'administration.
 * - header `x-api-key` ou `Authorization: Bearer <clé>` ;
 * - routes publiques (webhook Meta, capture de leads, tracking, santé) ;
 * - si ADMIN_API_KEY est vide, l'API reste ouverte (mode démo).
 */

const PUBLIC_ROUTES = new Set([
  "POST /api/leads",
  "POST /api/track",
  "GET /api/messaging/webhook",
  "POST /api/messaging/webhook",
  "GET /api/webhooks/meta",
  "POST /api/webhooks/meta",
  "GET /api/webhooks/tiktok",
  "POST /api/webhooks/tiktok",
  "GET /api/health",
]);

function bearerFrom(header?: string): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}

async function authPreHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  const path = req.url.split("?")[0];
  // Hors /api (statique, dashboard, landing pages) : public.
  if (!path.startsWith("/api/")) return;
  if (PUBLIC_ROUTES.has(`${req.method} ${path}`)) return;
  if (!config.auth.adminApiKey) return; // démo sans clé

  const key =
    (req.headers["x-api-key"] as string | undefined)?.trim() ??
    bearerFrom(req.headers.authorization);
  if (key !== config.auth.adminApiKey) {
    return reply.code(401).send({
      error: "Non autorisé. Fournissez la clé via le header x-api-key ou Authorization: Bearer.",
    });
  }
}

/**
 * À appeler sur l'instance racine AVANT l'enregistrement des routes :
 * les hooks ajoutés dans un plugin encapsulé ne s'appliquent pas
 * aux plugins frères.
 */
export function installAuth(app: FastifyInstance): void {
  app.addHook("preHandler", authPreHandler);
}
