// Test réel : nurturing avancé (opt-out) + webhooks TikTok (signature, ping, leads).
process.env.DEMO_MODE = "true";
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/hotel_marketing_test";
process.env.TIKTOK_CLIENT_SECRET = "test-tiktok-secret";

const root = "/Volumes/Extension Native Data System/Agent marketing hotel";
const { createHmac } = require("node:crypto");
const { PrismaClient } = require(root + "/node_modules/@prisma/client");
const { isOptOut, withinBusinessHours } = require(root + "/dist/inbound/leadCapture.js");
const { verifyTiktokSignature, handleTiktokEvent } = require(root + "/dist/messaging/tiktokWebhooks.js");

(async () => {
  const prisma = new PrismaClient();

  // 1. Opt-out
  console.log("── OPTOUT ──");
  console.log("isOptOut('STOP ne m\\'écrivez plus') :", isOptOut("STOP ne m'écrivez plus"));
  console.log("isOptOut('Quels sont vos tarifs ?') :", isOptOut("Quels sont vos tarifs ?"));

  // 2. Fenêtre horaire (NURTURE_HOURS=8-20, fuseau Africa/Douala)
  console.log("\n── FENÊTRE HORAIRE ──");
  console.log("withinBusinessHours() :", withinBusinessHours(), "(UTC actuel", new Date().toISOString() + ")");

  // 3. Signature TikTok
  console.log("\n── SIGNATURE TIKTOK ──");
  const body = JSON.stringify({ event_type: "lead", data: [{ lead: { name: "Alice", phone_number: "679000001" } }] });
  const sig = createHmac("sha256", "test-tiktok-secret").update(body).digest("hex");
  console.log("Signature valide acceptée :", verifyTiktokSignature(body, sig));
  console.log("Signature invalide rejetée :", !verifyTiktokSignature(body, "deadbeef"));
  console.log("Signature manquante rejetée :", !verifyTiktokSignature(body, undefined));

  // 4. Ping de validation
  console.log("\n── PING TIKTOK ──");
  console.log("handleTiktokEvent(ping) :", await handleTiktokEvent({ event_type: "ping" }));

  // 5. Capture d'un lead TikTok Ads
  console.log("\n── CAPTURE LEAD TIKTOK ──");
  const result = await handleTiktokEvent(JSON.parse(body));
  console.log("handleTiktokEvent(lead) :", result);
  const lead = await prisma.lead.findFirst({ where: { phone: "679000001" } });
  console.log("Lead capturé :", lead ? `✔ ${lead.name} / source=${lead.source}` : "❌ introuvable");

  // Nettoyage
  if (lead) {
    await prisma.messageLog.deleteMany({ where: { leadId: lead.id } });
    await prisma.lead.deleteMany({ where: { id: lead.id } });
  }
  await prisma.$disconnect();
  process.exit(0);
})();
