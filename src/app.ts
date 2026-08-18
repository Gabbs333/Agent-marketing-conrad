import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { installAuth } from "./auth";
import { prisma } from "./db";
import { generateLandingCopy, renderLandingPage } from "./inbound/landingPage";
import { adminRoutes } from "./routes/admin";

export interface BuildOptions {
  logger?: boolean;
}

/** Construit l'application Fastify (utilisé par le serveur et les tests E2E). */
export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  // CORS ouvert (API admin + capture publique de leads + dashboard)
  await app.register(cors, { origin: true });

  // Uploads (médiathèque)
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  // Fichiers statiques : médiathèque + dashboard
  // (@fastify/static v7 : une seule décoration `sendFile` — la 2e inscription la désactive)
  await app.register(fastifyStatic, {
    root: join(process.cwd(), "assets"),
    prefix: "/assets/",
  });
  await app.register(fastifyStatic, {
    root: join(process.cwd(), "public"),
    prefix: "/public/",
    decorateReply: false,
  });

  // Authentification par clé API (hook racine, avant les routes protégées)
  installAuth(app);

  // API complète sous /api
  await app.register(adminRoutes, { prefix: "/api" });

  // Landing page publique d'une campagne : /landing/:campaignId
  app.get<{ Params: { campaignId: string } }>("/landing/:campaignId", async (req, reply) => {
    let campaign;
    try {
      campaign = await prisma.campaign.findUnique({ where: { id: req.params.campaignId } });
    } catch (err) {
      return reply.code(500).send({ error: "Base de données indisponible" });
    }
    if (!campaign) return reply.code(404).send({ error: "Campagne introuvable" });
    const copy = await generateLandingCopy(campaign.name);
    const html = renderLandingPage({ campaignId: campaign.id, name: campaign.name, copy });
    return reply.type("text/html").send(html);
  });

  // Dashboard : /admin
  app.get("/admin", async (_req, reply) => reply.redirect("/public/admin.html"));

  return app;
}
