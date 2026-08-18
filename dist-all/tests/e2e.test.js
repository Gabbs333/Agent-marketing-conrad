"use strict";
/**
 * Test E2E de l'agent marketing hôtel.
 *
 * Prérequis : une base PostgreSQL de test (défaut : hotel_marketing_test).
 *   docker run -d --name hotel-pg-test -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=hotel_marketing_test -p 5432:5432 postgres:16
 *   TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/hotel_marketing_test" npm run test:e2e
 *
 * Le test pousse le schéma (db push), démarre l'application en mémoire
 * (fastify inject) et déroule le parcours complet en mode démo.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_child_process_1 = require("node:child_process");
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const TEST_DB = process.env.TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/hotel_marketing_test";
// Variables d'environnement AVANT tout import du code applicatif
process.env.DATABASE_URL = TEST_DB;
process.env.DEMO_MODE = "true";
process.env.ADMIN_API_KEY = "test-secret-123";
process.env.WEBHOOK_VERIFY_TOKEN = "test-verify-token";
process.env.NURTURE_CHANNELS = "email,whatsapp,messenger";
let app;
let prisma;
let buildApp;
const AUTH = { "x-api-key": "test-secret-123" };
let campaignId = "";
let leadId = "";
let postId = "";
(0, node_test_1.before)(async () => {
    try {
        (0, node_child_process_1.execSync)("npx prisma db push --skip-generate --accept-data-loss", {
            env: { ...process.env, DATABASE_URL: TEST_DB },
            stdio: "pipe",
        });
    }
    catch (e) {
        throw new Error(`PostgreSQL requis pour le test E2E (TEST_DATABASE_URL=${TEST_DB}).\n` +
            `Exemple : docker run -d --name hotel-pg-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hotel_marketing_test -p 5432:5432 postgres:16\n` +
            `Détail : ${e?.stderr?.toString() ?? e}`);
    }
    ({ buildApp } = await Promise.resolve().then(() => __importStar(require("../src/app"))));
    ({ prisma } = await Promise.resolve().then(() => __importStar(require("../src/db"))));
    // Nettoyage pour rendre le test idempotent (emails/PSID/téléphones fixes)
    await prisma.messageLog.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.lead.deleteMany();
    await prisma.ad.deleteMany();
    await prisma.post.deleteMany();
    await prisma.performance.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.campaign.deleteMany();
    app = await buildApp({ logger: false });
});
(0, node_test_1.after)(async () => {
    await app?.close();
    await prisma?.$disconnect();
});
async function req(method, url, body, headers = {}) {
    const res = await app.inject({
        method,
        url,
        payload: body !== undefined ? body : undefined,
        headers: { "content-type": "application/json", ...headers },
    });
    let data = null;
    try {
        data = res.body ? JSON.parse(res.body) : null;
    }
    catch {
        data = res.body;
    }
    return { status: res.statusCode, data };
}
(0, node_test_1.test)("santé : accessible sans clé API", async () => {
    const r = await req("GET", "/api/health");
    strict_1.default.equal(r.status, 200);
    strict_1.default.equal(r.data.ok, true);
    strict_1.default.equal(r.data.demoMode, true);
});
(0, node_test_1.test)("authentification : /api/dashboard exige la clé", async () => {
    const denied = await req("GET", "/api/dashboard");
    strict_1.default.equal(denied.status, 401);
    const allowed = await req("GET", "/api/dashboard", undefined, AUTH);
    strict_1.default.equal(allowed.status, 200);
});
(0, node_test_1.test)("campagne : création puis exécution du pipeline", async () => {
    const created = await req("POST", "/api/campaigns", { name: "Offre week-end -20%", objective: "awareness", budget: 500 }, AUTH);
    strict_1.default.equal(created.status, 201);
    campaignId = created.data.id;
    const run = await req("POST", `/api/campaigns/${campaignId}/run`, { publishNow: true, withVideo: false, withAds: false }, AUTH);
    strict_1.default.equal(run.status, 200);
    strict_1.default.ok(run.data.posts.length >= 2, "au moins 2 posts générés (facebook + tiktok)");
    strict_1.default.ok(run.data.media.length >= 1, "au moins 1 image générée");
    const posts = await req("GET", "/api/posts", undefined, AUTH);
    const published = posts.data.filter((p) => p.campaignId === campaignId);
    strict_1.default.ok(published.every((p) => p.status === "published"), "posts publiés (mode démo)");
});
(0, node_test_1.test)("médiathèque : contient l'image générée", async () => {
    const r = await req("GET", "/api/media", undefined, AUTH);
    strict_1.default.equal(r.status, 200);
    strict_1.default.ok(r.data.length >= 1);
    strict_1.default.equal(r.data[0].type, "image");
});
(0, node_test_1.test)("leads : capture publique, déduplication et accueil", async () => {
    const first = await req("POST", "/api/leads", {
        campaignId,
        source: "landing_page",
        name: "Marie Dupont",
        email: "marie@example.com",
        phone: "33611111111",
    });
    strict_1.default.equal(first.status, 201);
    strict_1.default.equal(first.data.isNew, true);
    leadId = first.data.lead.id;
    // déduplication
    const dup = await req("POST", "/api/leads", { campaignId, email: "marie@example.com" });
    strict_1.default.equal(dup.status, 200);
    strict_1.default.equal(dup.data.isNew, false);
    // message d'accueil journalisé (email en premier canal)
    const logs = await prisma.messageLog.findMany({ where: { leadId } });
    strict_1.default.ok(logs.some((m) => m.channel === "email" && m.status === "sent"), "accueil email envoyé");
});
(0, node_test_1.test)("messaging : referral Messenger crée un lead et un accueil", async () => {
    const r = await req("POST", "/api/messaging/webhook", {
        object: "page",
        entry: [
            {
                id: "123",
                messaging: [
                    { sender: { id: "psid-42", name: "Jean Martin" }, referral: { ref: `campaign_${campaignId}` } },
                ],
            },
        ],
    });
    strict_1.default.equal(r.status, 200);
    const lead = await prisma.lead.findFirst({ where: { messengerPsid: "psid-42" } });
    strict_1.default.ok(lead, "lead créé depuis le referral");
    strict_1.default.equal(lead.source, "messenger");
    strict_1.default.equal(lead.campaignId, campaignId);
    const logs = await prisma.messageLog.findMany({ where: { leadId: lead.id } });
    strict_1.default.ok(logs.some((m) => m.channel === "messenger" && m.status === "sent"), "accueil Messenger envoyé");
});
(0, node_test_1.test)("messaging : message WhatsApp entrant → lead + réponse auto + journal", async () => {
    const r = await req("POST", "/api/messaging/webhook", {
        object: "whatsapp_business_account",
        entry: [
            {
                changes: [
                    {
                        field: "messages",
                        value: {
                            messages: [
                                { from: "33700000001", type: "text", text: { body: "Bonjour, avez-vous des disponibilités ?" } },
                            ],
                        },
                    },
                ],
            },
        ],
    });
    strict_1.default.equal(r.status, 200);
    const lead = await prisma.lead.findFirst({ where: { phone: "33700000001" } });
    strict_1.default.ok(lead, "lead WhatsApp créé");
    strict_1.default.equal(lead.status, "replied");
    const logs = await prisma.messageLog.findMany({ where: { leadId: lead.id } });
    strict_1.default.ok(logs.some((m) => m.direction === "inbound" && m.status === "received"), "message entrant journalisé");
    strict_1.default.ok(logs.some((m) => m.direction === "outbound" && m.channel === "whatsapp" && m.status === "sent"), "réponse automatique WhatsApp envoyée");
});
(0, node_test_1.test)("messaging : vérification du webhook (challenge)", async () => {
    const r = await req("GET", "/api/messaging/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=CHALLENGE_42");
    strict_1.default.equal(r.status, 200);
    strict_1.default.equal(r.data, "CHALLENGE_42");
});
(0, node_test_1.test)("nurturing : envoi de l'étape suivante aux leads éligibles", async () => {
    // rendre le lead éligible (créé il y a plus de 24 h)
    await prisma.lead.update({
        where: { id: leadId },
        data: { createdAt: new Date(Date.now() - 48 * 3600 * 1000) },
    });
    const r = await req("POST", "/api/leads/nurture", {}, AUTH);
    strict_1.default.equal(r.status, 200);
    strict_1.default.ok(r.data.sent >= 1, "au moins un message de nurturing envoyé");
    const logs = await prisma.messageLog.findMany({
        where: { leadId, direction: "outbound", status: "sent" },
    });
    strict_1.default.ok(logs.length >= 2, "accueil + relance journalisés");
});
(0, node_test_1.test)("conversion : lead → réservation", async () => {
    const r = await req("POST", `/api/leads/${leadId}/convert`, { checkIn: "2026-09-01", checkOut: "2026-09-03", guests: 2, amount: 320 }, AUTH);
    strict_1.default.equal(r.status, 201);
    strict_1.default.equal(r.data.status, "confirmed");
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    strict_1.default.equal(lead.status, "booked");
    const dash = await req("GET", "/api/dashboard", undefined, AUTH);
    strict_1.default.equal(dash.data.bookings.total, 1);
    strict_1.default.equal(dash.data.bookings.revenue, 320);
});
(0, node_test_1.test)("posts : planification puis publication automatique", async () => {
    const created = await req("POST", "/api/posts", { platform: "facebook", topic: "Soirée au rooftop" }, AUTH);
    strict_1.default.equal(created.status, 201);
    postId = created.data.id;
    const past = new Date(Date.now() - 60_000).toISOString();
    const scheduled = await req("POST", `/api/posts/${postId}/schedule`, { scheduledAt: past }, AUTH);
    strict_1.default.equal(scheduled.data.status, "scheduled");
    const run = await req("POST", "/api/posts/run-scheduled", {}, AUTH);
    strict_1.default.ok(run.data.published >= 1);
    const post = await prisma.post.findUnique({ where: { id: postId } });
    strict_1.default.equal(post.status, "published");
    strict_1.default.ok(post.externalId);
});
(0, node_test_1.test)("médiathèque : upload avec catégorisation, édition et filtres", async () => {
    const { createPng } = await Promise.resolve().then(() => __importStar(require("../src/lib/files")));
    const png = createPng(90, 90, (x, y) => [(x * 3) % 256, (y * 7) % 256, 90]);
    // Upload multipart avec métadonnées (champs AVANT le fichier)
    const boundary = "----hoteltest";
    const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nspa\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nPiscine intérieure chauffée\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\nbien-etre, detente\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="spa.png"\r\nContent-Type: image/png\r\n\r\n`),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({
        method: "POST",
        url: "/api/media/upload",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}`, ...AUTH },
        payload,
    });
    strict_1.default.equal(up.statusCode, 201);
    const asset = JSON.parse(up.body);
    strict_1.default.equal(asset.category, "spa");
    strict_1.default.equal(asset.caption, "Piscine intérieure chauffée");
    // Filtre par catégorie
    const filtered = await req("GET", "/api/media?category=spa", undefined, AUTH);
    strict_1.default.equal(filtered.status, 200);
    strict_1.default.ok(filtered.data.some((a) => a.id === asset.id));
    // Catégories + compteurs
    const cats = await req("GET", "/api/media/categories", undefined, AUTH);
    strict_1.default.ok(cats.data.some((c) => c.category === "spa" && c.count >= 1));
    // Édition des métadonnées
    const patched = await req("PATCH", `/api/media/${asset.id}`, { category: "piscine", tags: "eau, nuit" }, AUTH);
    strict_1.default.equal(patched.status, 200);
    strict_1.default.equal(patched.data.category, "piscine");
    strict_1.default.equal(patched.data.caption, "Piscine intérieure chauffée");
});
(0, node_test_1.test)("calendrier éditorial : créneaux, styles et génération", async () => {
    const cal = await req("GET", "/api/calendar", undefined, AUTH);
    strict_1.default.equal(cal.status, 200);
    strict_1.default.ok(Array.isArray(cal.data.slots) && cal.data.slots.length > 0, "créneaux par défaut créés");
    strict_1.default.ok(cal.data.styles.facebook && cal.data.styles.tiktok, "styles par plateforme présents");
    strict_1.default.ok(cal.data.styles.facebook.tone.includes("Chaleureux"));
    // Créneau demain à 09:00 (texte, rapide)
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const dow = ((tomorrow.getDay() + 6) % 7) + 1;
    const created = await req("POST", "/api/calendar", {
        platform: "facebook", dayOfWeek: dow, time: "09:00", type: "text", topic: "Offre test calendrier", tone: "incitatif",
    }, AUTH);
    strict_1.default.equal(created.status, 201);
    const gen = await req("POST", "/api/calendar/generate", { days: 2 }, AUTH);
    strict_1.default.equal(gen.status, 200);
    strict_1.default.ok(gen.data.created >= 1, `posts générés : ${JSON.stringify(gen.data)}`);
    const post = await prisma.post.findFirst({ where: { calendarSlotId: created.data.id } });
    strict_1.default.ok(post, "post rattaché au créneau");
    strict_1.default.equal(post.status, "scheduled");
    strict_1.default.ok(post.text.includes("Offre test calendrier"));
    // Idempotence : la seconde génération ne duplique pas
    const again = await req("POST", "/api/calendar/generate", { days: 2 }, AUTH);
    strict_1.default.equal(again.data.created, 0, "aucun doublon");
    // Suppression du créneau de test
    const del = await req("DELETE", `/api/calendar/${created.data.id}`, undefined, AUTH);
    strict_1.default.equal(del.status, 200);
});
(0, node_test_1.test)("médiathèque : collecte des médias d'un site web", async () => {
    const { createServer } = await Promise.resolve().then(() => __importStar(require("node:http")));
    const { createPng } = await Promise.resolve().then(() => __importStar(require("../src/lib/files")));
    // Deux images « bruyées » (> 2 Ko) + un logo à ignorer
    const imgA = createPng(100, 100, (x, y) => [(x * 7) % 256, (y * 11) % 256, ((x + y) * 13) % 256]);
    const imgB = createPng(100, 100, (x, y) => [(y * 5) % 256, (x * 9) % 256, 128]);
    const server = createServer((req, res) => {
        if (req.url === "/page.html") {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end('<html><body><img src="/a.png"><img src="/b.png"><img src="/logo.png"></body></html>');
        }
        else if (req.url === "/a.png") {
            res.writeHead(200, { "Content-Type": "image/png" });
            res.end(imgA);
        }
        else if (req.url === "/b.png") {
            res.writeHead(200, { "Content-Type": "image/png" });
            res.end(imgB);
        }
        else {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = server.address().port;
    try {
        const r = await req("POST", "/api/media/collect", { url: `http://127.0.0.1:${port}/page.html`, max: 10 }, AUTH);
        strict_1.default.equal(r.status, 200);
        // a.png + b.png collectés, logo.png filtré par la liste noire
        strict_1.default.equal(r.data.collected, 2, `collectés : ${JSON.stringify(r.data)}`);
        const assets = await prisma.mediaAsset.findMany({ where: { source: { not: null } } });
        strict_1.default.ok(assets.length >= 2);
        strict_1.default.ok(assets.every((a) => a.localPath && a.url.startsWith("/assets/")));
    }
    finally {
        server.close();
    }
});
(0, node_test_1.test)("vidéo : génération depuis la médiathèque (si ffmpeg)", async (t) => {
    const { hasFfmpeg } = await Promise.resolve().then(() => __importStar(require("../src/content/videoGenerator")));
    if (!(await hasFfmpeg())) {
        t.skip("ffmpeg non installé");
        return;
    }
    // Le pipeline assemble la vidéo à partir des images de la médiathèque
    const run = await req("POST", `/api/campaigns/${campaignId}/run`, { publishNow: false, withVideo: true, withAds: false }, AUTH);
    strict_1.default.equal(run.status, 200);
    strict_1.default.equal(run.data.errors.length, 0, `erreurs : ${JSON.stringify(run.data.errors)}`);
    const media = await req("GET", "/api/media", undefined, AUTH);
    const video = media.data.find((m) => m.type === "video");
    strict_1.default.ok(video, "un média vidéo doit exister dans la médiathèque");
    const { statSync } = await Promise.resolve().then(() => __importStar(require("node:fs")));
    const { join } = await Promise.resolve().then(() => __importStar(require("node:path")));
    const size = statSync(join(process.cwd(), video.localPath)).size;
    strict_1.default.ok(size > 1000, `fichier vidéo non vide (${size} octets)`);
    const tt = await prisma.post.findFirst({ where: { campaignId, platform: "tiktok", mediaType: "video" } });
    strict_1.default.ok(tt, "le post TikTok doit porter la vidéo");
    // mode « ai » sans clé IA : doit se replier sur ffmpeg
    const images = media.data.filter((m) => m.type === "image");
    const ai = await req("POST", "/api/content/video", { topic: "Spa et détente", images: [images[0].url], mode: "ai" }, AUTH);
    strict_1.default.equal(ai.status, 200, `repli ffmpeg : ${JSON.stringify(ai.data)}`);
    strict_1.default.ok(ai.data.url.endsWith(".mp4"));
});
(0, node_test_1.test)("intégrations : état des connexions et URL OAuth TikTok", async () => {
    const status = await req("GET", "/api/integrations/status", undefined, AUTH);
    strict_1.default.equal(status.status, 200);
    const keys = status.data.map((s) => s.key);
    for (const k of ["facebook", "messenger", "whatsapp", "metaAds", "tiktok", "tiktokAds", "openai", "email"]) {
        strict_1.default.ok(keys.includes(k), `intégration manquante : ${k}`);
    }
    const tiktok = status.data.find((s) => s.key === "tiktok");
    strict_1.default.equal(tiktok.configured, false, "pas de token TikTok en mode démo/test");
    const authUrl = await req("GET", "/api/integrations/tiktok/auth-url?redirectUri=https%3A%2F%2Fexample.com%2Fcallback", undefined, AUTH);
    strict_1.default.equal(authUrl.status, 200);
    strict_1.default.ok(String(authUrl.data.url).includes("tiktok.com"), "URL d'autorisation TikTok générée");
});
(0, node_test_1.test)("ton de campagne : création, presets et édition", async () => {
    const tones = await req("GET", "/api/content/tones", undefined, AUTH);
    strict_1.default.equal(tones.status, 200);
    strict_1.default.ok(tones.data.some((t) => t.id === "luxueux et exclusif"));
    const created = await req("POST", "/api/campaigns", { name: "Campagne ton test", tone: "luxueux et exclusif" }, AUTH);
    strict_1.default.equal(created.data.tone, "luxueux et exclusif");
    const patched = await req("PATCH", `/api/campaigns/${created.data.id}`, { tone: "romantique et poétique" }, AUTH);
    strict_1.default.equal(patched.status, 200);
    strict_1.default.equal(patched.data.tone, "romantique et poétique");
});
(0, node_test_1.test)("relecture IA des brouillons avant publication", async () => {
    // Brouillon médiocre : trop court, sans CTA
    const bad = await req("POST", "/api/posts", { platform: "facebook", text: "Bonjour" }, AUTH);
    strict_1.default.equal(bad.status, 201);
    const review = await req("POST", `/api/posts/${bad.data.id}/review`, {}, AUTH);
    strict_1.default.equal(review.status, 200);
    strict_1.default.ok(review.data.score < 40, `score bas attendu : ${review.data.score}`);
    strict_1.default.equal(review.data.verdict, "needs_work");
    strict_1.default.ok(review.data.issues.length >= 2);
    // La publication est bloquée par la relecture
    const blocked = await req("POST", `/api/posts/${bad.data.id}/publish`, {}, AUTH);
    strict_1.default.equal(blocked.status, 500);
    strict_1.default.ok(String(blocked.data.error).includes("Relecture IA refusée"));
    const p1 = await prisma.post.findUnique({ where: { id: bad.data.id } });
    strict_1.default.equal(p1.status, "needs_review");
    // Correction du texte puis publication
    await req("PATCH", `/api/posts/${bad.data.id}`, { text: "Découvrez nos suites d'exception au Conrad Grand Luxury Hotel. Profitez du spa et réservez votre séjour dès maintenant !" }, AUTH);
    const pub = await req("POST", `/api/posts/${bad.data.id}/publish`, {}, AUTH);
    strict_1.default.equal(pub.status, 200, JSON.stringify(pub.data));
    const p2 = await prisma.post.findUnique({ where: { id: bad.data.id } });
    strict_1.default.equal(p2.status, "published");
    strict_1.default.ok((p2.reviewScore ?? 0) >= 40, `score de relecture ${p2.reviewScore}`);
});
(0, node_test_1.test)("intégrations : persistance des tokens dans un fichier .env", async () => {
    const { setEnvValue } = await Promise.resolve().then(() => __importStar(require("../src/integrations/persist")));
    const { mkdtempSync, readFileSync } = await Promise.resolve().then(() => __importStar(require("node:fs")));
    const { tmpdir } = await Promise.resolve().then(() => __importStar(require("node:os")));
    const { join } = await Promise.resolve().then(() => __importStar(require("node:path")));
    const file = join(mkdtempSync(join(tmpdir(), "hotel-env-")), ".env");
    await setEnvValue("A_KEY", "value1", file);
    await setEnvValue("A_KEY", "value2", file);
    await setEnvValue("B_KEY", "avec espace", file);
    const content = readFileSync(file, "utf8");
    strict_1.default.ok(content.includes("A_KEY=value2"), "la valeur est mise à jour sans doublon");
    strict_1.default.ok(content.includes('B_KEY="avec espace"'), "les valeurs avec espaces sont quotées");
    strict_1.default.equal(content.split("\n").filter((l) => l.startsWith("A_KEY=")).length, 1, "aucun doublon de clé");
});
//# sourceMappingURL=e2e.test.js.map