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

import { execSync } from "node:child_process";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/hotel_marketing_test";

// Variables d'environnement AVANT tout import du code applicatif
process.env.DATABASE_URL = TEST_DB;
process.env.DEMO_MODE = "true";
process.env.ADMIN_API_KEY = "test-secret-123";
process.env.WEBHOOK_VERIFY_TOKEN = "test-verify-token";
process.env.NURTURE_CHANNELS = "email,whatsapp,messenger";
process.env.NURTURE_HOURS = ""; // envois à toute heure dans les tests

let app: any;
let prisma: any;
let buildApp: any;
const AUTH = { "x-api-key": "test-secret-123" };

let campaignId = "";
let leadId = "";
let postId = "";

before(async () => {
  try {
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      env: { ...process.env, DATABASE_URL: TEST_DB },
      stdio: "pipe",
    });
  } catch (e: any) {
    throw new Error(
      `PostgreSQL requis pour le test E2E (TEST_DATABASE_URL=${TEST_DB}).\n` +
        `Exemple : docker run -d --name hotel-pg-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hotel_marketing_test -p 5432:5432 postgres:16\n` +
        `Détail : ${e?.stderr?.toString() ?? e}`,
    );
  }

  ({ buildApp } = await import("../src/app"));
  ({ prisma } = await import("../src/db"));

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

after(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

async function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method,
    url,
    payload: body !== undefined ? body : undefined,
    headers: { "content-type": "application/json", ...headers },
  });
  let data: any = null;
  try {
    data = res.body ? JSON.parse(res.body) : null;
  } catch {
    data = res.body;
  }
  return { status: res.statusCode, data };
}

test("santé : accessible sans clé API", async () => {
  const r = await req("GET", "/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.demoMode, true);
});

test("authentification : /api/dashboard exige la clé", async () => {
  const denied = await req("GET", "/api/dashboard");
  assert.equal(denied.status, 401);

  const allowed = await req("GET", "/api/dashboard", undefined, AUTH);
  assert.equal(allowed.status, 200);
});

test("campagne : création puis exécution du pipeline", async () => {
  const created = await req(
    "POST",
    "/api/campaigns",
    { name: "Offre week-end -20%", objective: "awareness", budget: 500 },
    AUTH,
  );
  assert.equal(created.status, 201);
  campaignId = created.data.id;

  const run = await req(
    "POST",
    `/api/campaigns/${campaignId}/run`,
    { publishNow: true, withVideo: false, withAds: false },
    AUTH,
  );
  assert.equal(run.status, 200);
  assert.ok(run.data.posts.length >= 2, "au moins 2 posts générés (facebook + tiktok)");
  assert.ok(run.data.media.length >= 1, "au moins 1 image générée");

  const posts = await req("GET", "/api/posts", undefined, AUTH);
  const published = (posts.data as any[]).filter((p) => p.campaignId === campaignId);
  assert.ok(published.every((p) => p.status === "published"), "posts publiés (mode démo)");
});

test("médiathèque : contient l'image générée", async () => {
  const r = await req("GET", "/api/media", undefined, AUTH);
  assert.equal(r.status, 200);
  assert.ok(r.data.length >= 1);
  assert.equal(r.data[0].type, "image");
});

test("leads : capture publique, déduplication et accueil", async () => {
  const first = await req("POST", "/api/leads", {
    campaignId,
    source: "landing_page",
    name: "Marie Dupont",
    email: "marie@example.com",
    phone: "33611111111",
  });
  assert.equal(first.status, 201);
  assert.equal(first.data.isNew, true);
  leadId = first.data.lead.id;

  // déduplication
  const dup = await req("POST", "/api/leads", { campaignId, email: "marie@example.com" });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.isNew, false);

  // message d'accueil journalisé (email en premier canal)
  const logs = await prisma.messageLog.findMany({ where: { leadId } });
  assert.ok(logs.some((m: any) => m.channel === "email" && m.status === "sent"), "accueil email envoyé");
});

test("messaging : referral Messenger crée un lead et un accueil", async () => {
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
  assert.equal(r.status, 200);

  const lead = await prisma.lead.findFirst({ where: { messengerPsid: "psid-42" } });
  assert.ok(lead, "lead créé depuis le referral");
  assert.equal(lead.source, "messenger");
  assert.equal(lead.campaignId, campaignId);

  const logs = await prisma.messageLog.findMany({ where: { leadId: lead.id } });
  assert.ok(logs.some((m: any) => m.channel === "messenger" && m.status === "sent"), "accueil Messenger envoyé");
});

test("messaging : message WhatsApp entrant → lead + réponse auto + journal", async () => {
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
  assert.equal(r.status, 200);

  const lead = await prisma.lead.findFirst({ where: { phone: "33700000001" } });
  assert.ok(lead, "lead WhatsApp créé");
  assert.equal(lead.status, "replied");

  const logs = await prisma.messageLog.findMany({ where: { leadId: lead.id } });
  assert.ok(logs.some((m: any) => m.direction === "inbound" && m.status === "received"), "message entrant journalisé");
  assert.ok(
    logs.some((m: any) => m.direction === "outbound" && m.channel === "whatsapp" && m.status === "sent"),
    "réponse automatique WhatsApp envoyée",
  );
});

test("messaging : vérification du webhook (challenge)", async () => {
  const r = await req(
    "GET",
    "/api/messaging/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=CHALLENGE_42",
  );
  assert.equal(r.status, 200);
  assert.equal(r.data, "CHALLENGE_42");
});

test("nurturing : envoi de l'étape suivante aux leads éligibles", async () => {
  // rendre le lead éligible : anciens messages sortants (intervalle mesuré
  // sur le dernier envoi, et non sur la création du lead)
  const old = new Date(Date.now() - 96 * 3600 * 1000);
  await prisma.messageLog.updateMany({
    where: { leadId, direction: "outbound" },
    data: { sentAt: old, createdAt: old },
  });
  const r = await req("POST", "/api/leads/nurture", {}, AUTH);
  assert.equal(r.status, 200);
  assert.ok(r.data.sent >= 1, "au moins un message de nurturing envoyé");

  const logs = await prisma.messageLog.findMany({
    where: { leadId, direction: "outbound", status: "sent" },
  });
  assert.ok(logs.length >= 2, "accueil + relance journalisés");
});

test("conversion : lead → réservation", async () => {
  const r = await req(
    "POST",
    `/api/leads/${leadId}/convert`,
    { checkIn: "2026-09-01", checkOut: "2026-09-03", guests: 2, amount: 320 },
    AUTH,
  );
  assert.equal(r.status, 201);
  assert.equal(r.data.status, "confirmed");

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  assert.equal(lead.status, "booked");

  const dash = await req("GET", "/api/dashboard", undefined, AUTH);
  assert.equal(dash.data.bookings.total, 1);
  assert.equal(dash.data.bookings.revenue, 320);
});

test("posts : planification puis publication automatique", async () => {
  const created = await req("POST", "/api/posts", { platform: "facebook", topic: "Soirée au rooftop" }, AUTH);
  assert.equal(created.status, 201);
  postId = created.data.id;

  const past = new Date(Date.now() - 60_000).toISOString();
  const scheduled = await req("POST", `/api/posts/${postId}/schedule`, { scheduledAt: past }, AUTH);
  assert.equal(scheduled.data.status, "scheduled");

  const run = await req("POST", "/api/posts/run-scheduled", {}, AUTH);
  assert.ok(run.data.published >= 1);

  const post = await prisma.post.findUnique({ where: { id: postId } });
  assert.equal(post.status, "published");
  assert.ok(post.externalId);
});

test("médiathèque : upload avec catégorisation, édition et filtres", async () => {
  const { createPng } = await import("../src/lib/files");
  const png = createPng(90, 90, (x, y) => [(x * 3) % 256, (y * 7) % 256, 90]);

  // Upload multipart avec métadonnées (champs AVANT le fichier)
  const boundary = "----hoteltest";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nspa\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nPiscine intérieure chauffée\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\nbien-etre, detente\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="spa.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const up = await app.inject({
    method: "POST",
    url: "/api/media/upload",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, ...AUTH },
    payload,
  });
  assert.equal(up.statusCode, 201);
  const asset = JSON.parse(up.body);
  assert.equal(asset.category, "spa");
  assert.equal(asset.caption, "Piscine intérieure chauffée");

  // Filtre par catégorie
  const filtered = await req("GET", "/api/media?category=spa", undefined, AUTH);
  assert.equal(filtered.status, 200);
  assert.ok((filtered.data as any[]).some((a) => a.id === asset.id));

  // Catégories + compteurs
  const cats = await req("GET", "/api/media/categories", undefined, AUTH);
  assert.ok((cats.data as any[]).some((c) => c.category === "spa" && c.count >= 1));

  // Édition des métadonnées
  const patched = await req("PATCH", `/api/media/${asset.id}`, { category: "piscine", tags: "eau, nuit" }, AUTH);
  assert.equal(patched.status, 200);
  assert.equal(patched.data.category, "piscine");
  assert.equal(patched.data.caption, "Piscine intérieure chauffée");
});

test("calendrier éditorial : créneaux, styles et génération", async () => {
  const cal = await req("GET", "/api/calendar", undefined, AUTH);
  assert.equal(cal.status, 200);
  assert.ok(Array.isArray(cal.data.slots) && cal.data.slots.length > 0, "créneaux par défaut créés");
  assert.ok(cal.data.styles.facebook && cal.data.styles.tiktok, "styles par plateforme présents");
  assert.ok(cal.data.styles.facebook.tone.includes("Chaleureux"));

  // Créneau demain à 09:00 (texte, rapide)
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const dow = ((tomorrow.getDay() + 6) % 7) + 1;
  const created = await req("POST", "/api/calendar", {
    platform: "facebook", dayOfWeek: dow, time: "09:00", type: "text", topic: "Offre test calendrier", tone: "incitatif",
  }, AUTH);
  assert.equal(created.status, 201);

  const gen = await req("POST", "/api/calendar/generate", { days: 2 }, AUTH);
  assert.equal(gen.status, 200);
  assert.ok(gen.data.created >= 1, `posts générés : ${JSON.stringify(gen.data)}`);

  const post = await prisma.post.findFirst({ where: { calendarSlotId: created.data.id } });
  assert.ok(post, "post rattaché au créneau");
  assert.equal(post.status, "scheduled");
  assert.ok(post.text.includes("Offre test calendrier"));

  // Idempotence : la seconde génération ne duplique pas
  const again = await req("POST", "/api/calendar/generate", { days: 2 }, AUTH);
  assert.equal(again.data.created, 0, "aucun doublon");

  // Suppression du créneau de test
  const del = await req("DELETE", `/api/calendar/${created.data.id}`, undefined, AUTH);
  assert.equal(del.status, 200);
});

test("médiathèque : collecte des médias d'un site web", async () => {
  const { createServer } = await import("node:http");
  const { createPng } = await import("../src/lib/files");

  // Deux images « bruyées » (> 2 Ko) + un logo à ignorer
  const imgA = createPng(100, 100, (x, y) => [(x * 7) % 256, (y * 11) % 256, ((x + y) * 13) % 256]);
  const imgB = createPng(100, 100, (x, y) => [(y * 5) % 256, (x * 9) % 256, 128]);

  const server = createServer((req, res) => {
    if (req.url === "/page.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end('<html><body><img src="/a.png"><img src="/b.png"><img src="/logo.png"></body></html>');
    } else if (req.url === "/a.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(imgA);
    } else if (req.url === "/b.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(imgB);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;

  try {
    const r = await req(
      "POST",
      "/api/media/collect",
      { url: `http://127.0.0.1:${port}/page.html`, max: 10 },
      AUTH,
    );
    assert.equal(r.status, 200);
    // a.png + b.png collectés, logo.png filtré par la liste noire
    assert.equal(r.data.collected, 2, `collectés : ${JSON.stringify(r.data)}`);

    const assets = await prisma.mediaAsset.findMany({ where: { source: { not: null } } });
    assert.ok(assets.length >= 2);
    assert.ok(assets.every((a: any) => a.localPath && a.url.startsWith("/assets/")));
  } finally {
    server.close();
  }
});

test("vidéo : génération depuis la médiathèque (si ffmpeg)", async (t) => {
  const { hasFfmpeg } = await import("../src/content/videoGenerator");
  if (!(await hasFfmpeg())) {
    t.skip("ffmpeg non installé");
    return;
  }

  // Le pipeline assemble la vidéo à partir des images de la médiathèque
  const run = await req(
    "POST",
    `/api/campaigns/${campaignId}/run`,
    { publishNow: false, withVideo: true, withAds: false },
    AUTH,
  );
  assert.equal(run.status, 200);
  assert.equal(run.data.errors.length, 0, `erreurs : ${JSON.stringify(run.data.errors)}`);

  const media = await req("GET", "/api/media", undefined, AUTH);
  const video = (media.data as any[]).find((m) => m.type === "video");
  assert.ok(video, "un média vidéo doit exister dans la médiathèque");

  const { statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const size = statSync(join(process.cwd(), video.localPath)).size;
  assert.ok(size > 1000, `fichier vidéo non vide (${size} octets)`);

  const tt = await prisma.post.findFirst({ where: { campaignId, platform: "tiktok", mediaType: "video" } });
  assert.ok(tt, "le post TikTok doit porter la vidéo");

  // mode « ai » sans clé IA : doit se replier sur ffmpeg
  const images = (media.data as any[]).filter((m) => m.type === "image");
  const ai = await req(
    "POST",
    "/api/content/video",
    { topic: "Spa et détente", images: [images[0].url], mode: "ai" },
    AUTH,
  );
  assert.equal(ai.status, 200, `repli ffmpeg : ${JSON.stringify(ai.data)}`);
  assert.ok(ai.data.url.endsWith(".mp4"));
});

test("intégrations : état des connexions et URL OAuth TikTok", async () => {
  const status = await req("GET", "/api/integrations/status", undefined, AUTH);
  assert.equal(status.status, 200);
  const keys = (status.data as any[]).map((s) => s.key);
  for (const k of ["facebook", "messenger", "whatsapp", "metaAds", "tiktok", "tiktokAds", "openai", "email"]) {
    assert.ok(keys.includes(k), `intégration manquante : ${k}`);
  }
  const tiktok = (status.data as any[]).find((s) => s.key === "tiktok");
  assert.equal(tiktok.configured, false, "pas de token TikTok en mode démo/test");

  const authUrl = await req(
    "GET",
    "/api/integrations/tiktok/auth-url?redirectUri=https%3A%2F%2Fexample.com%2Fcallback",
    undefined,
    AUTH,
  );
  assert.equal(authUrl.status, 200);
  assert.ok(String(authUrl.data.url).includes("tiktok.com"), "URL d'autorisation TikTok générée");
});

test("ton de campagne : création, presets et édition", async () => {
  const tones = await req("GET", "/api/content/tones", undefined, AUTH);
  assert.equal(tones.status, 200);
  assert.ok((tones.data as any[]).some((t) => t.id === "luxueux et exclusif"));

  const created = await req(
    "POST",
    "/api/campaigns",
    { name: "Campagne ton test", tone: "luxueux et exclusif" },
    AUTH,
  );
  assert.equal(created.data.tone, "luxueux et exclusif");

  const patched = await req(
    "PATCH",
    `/api/campaigns/${created.data.id}`,
    { tone: "romantique et poétique" },
    AUTH,
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.data.tone, "romantique et poétique");
});

test("relecture IA des brouillons avant publication", async () => {
  // Brouillon médiocre : trop court, sans CTA
  const bad = await req("POST", "/api/posts", { platform: "facebook", text: "Bonjour" }, AUTH);
  assert.equal(bad.status, 201);

  const review = await req("POST", `/api/posts/${bad.data.id}/review`, {}, AUTH);
  assert.equal(review.status, 200);
  assert.ok(review.data.score < 40, `score bas attendu : ${review.data.score}`);
  assert.equal(review.data.verdict, "needs_work");
  assert.ok(review.data.issues.length >= 2);

  // La publication est bloquée par la relecture
  const blocked = await req("POST", `/api/posts/${bad.data.id}/publish`, {}, AUTH);
  assert.equal(blocked.status, 500);
  assert.ok(String(blocked.data.error).includes("Relecture IA refusée"));
  const p1 = await prisma.post.findUnique({ where: { id: bad.data.id } });
  assert.equal(p1.status, "needs_review");

  // Correction du texte puis publication
  await req(
    "PATCH",
    `/api/posts/${bad.data.id}`,
    { text: "Découvrez nos suites d'exception au Conrad Grand Luxury Hotel. Profitez du spa et réservez votre séjour dès maintenant !" },
    AUTH,
  );
  const pub = await req("POST", `/api/posts/${bad.data.id}/publish`, {}, AUTH);
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  const p2 = await prisma.post.findUnique({ where: { id: bad.data.id } });
  assert.equal(p2.status, "published");
  assert.ok((p2.reviewScore ?? 0) >= 40, `score de relecture ${p2.reviewScore}`);
});

test("intégrations : persistance des tokens dans un fichier .env", async () => {
  const { setEnvValue } = await import("../src/integrations/persist");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const file = join(mkdtempSync(join(tmpdir(), "hotel-env-")), ".env");
  await setEnvValue("A_KEY", "value1", file);
  await setEnvValue("A_KEY", "value2", file);
  await setEnvValue("B_KEY", "avec espace", file);

  const content = readFileSync(file, "utf8");
  assert.ok(content.includes("A_KEY=value2"), "la valeur est mise à jour sans doublon");
  assert.ok(content.includes('B_KEY="avec espace"'), "les valeurs avec espaces sont quotées");
  assert.equal(
    content.split("\n").filter((l) => l.startsWith("A_KEY=")).length,
    1,
    "aucun doublon de clé",
  );
});
