"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
const node_path_1 = require("node:path");
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const static_1 = __importDefault(require("@fastify/static"));
const auth_1 = require("./auth");
const db_1 = require("./db");
const landingPage_1 = require("./inbound/landingPage");
const admin_1 = require("./routes/admin");
/** Construit l'application Fastify (utilisé par le serveur et les tests E2E). */
async function buildApp(opts = {}) {
    const app = (0, fastify_1.default)({ logger: opts.logger ?? true });
    // CORS ouvert (API admin + capture publique de leads + dashboard)
    await app.register(cors_1.default, { origin: true });
    // Uploads (médiathèque)
    await app.register(multipart_1.default, { limits: { fileSize: 200 * 1024 * 1024 } });
    // Fichiers statiques : médiathèque + dashboard
    // (@fastify/static v7 : une seule décoration `sendFile` — la 2e inscription la désactive)
    await app.register(static_1.default, {
        root: (0, node_path_1.join)(process.cwd(), "assets"),
        prefix: "/assets/",
    });
    await app.register(static_1.default, {
        root: (0, node_path_1.join)(process.cwd(), "public"),
        prefix: "/public/",
        decorateReply: false,
    });
    // Authentification par clé API (hook racine, avant les routes protégées)
    (0, auth_1.installAuth)(app);
    // API complète sous /api
    await app.register(admin_1.adminRoutes, { prefix: "/api" });
    // Landing page publique d'une campagne : /landing/:campaignId
    app.get("/landing/:campaignId", async (req, reply) => {
        let campaign;
        try {
            campaign = await db_1.prisma.campaign.findUnique({ where: { id: req.params.campaignId } });
        }
        catch (err) {
            return reply.code(500).send({ error: "Base de données indisponible" });
        }
        if (!campaign)
            return reply.code(404).send({ error: "Campagne introuvable" });
        const copy = await (0, landingPage_1.generateLandingCopy)(campaign.name);
        const html = (0, landingPage_1.renderLandingPage)({ campaignId: campaign.id, name: campaign.name, copy });
        return reply.type("text/html").send(html);
    });
    // Dashboard : /admin
    app.get("/admin", async (_req, reply) => reply.redirect("/public/admin.html"));
    return app;
}
//# sourceMappingURL=app.js.map