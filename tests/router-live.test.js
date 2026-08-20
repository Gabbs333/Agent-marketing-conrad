// Test réel du routeur de cohabitation marketing / réceptionniste.
process.env.DEMO_MODE = "true";
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/hotel_marketing_test";
process.env.RECEPTIONIST_WEBHOOK_URL = "http://127.0.0.1:9876/reception";

const root = "/Volumes/Extension Native Data System/Agent marketing hotel";
const http = require("node:http");
const { handleWebhookEvent } = require(root + "/dist/messaging/webhooks.js");
const { routerEnabled } = require(root + "/dist/messaging/router.js");
const { PrismaClient } = require(root + "/node_modules/@prisma/client");

(async () => {
  console.log("Routeur activé :", routerEnabled());

  const forwarded = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      forwarded.push({ headers: req.headers, body: JSON.parse(data) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(9876, r));

  const stats = await handleWebhookEvent({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                { from: "33600000001", type: "text", text: { body: "Je voudrais réserver une suite pour deux nuits" } },
                { from: "33600000002", type: "text", text: { body: "La piscine ferme à quelle heure ?" } },
              ],
            },
          },
        ],
      },
    ],
  });

  const prisma = new PrismaClient();
  const marketingLead = await prisma.lead.findFirst({ where: { phone: "33600000001" } });
  const receptionLead = await prisma.lead.findFirst({ where: { phone: "33600000002" } });
  const cleanIds = [marketingLead?.id, receptionLead?.id].filter(Boolean);
  if (cleanIds.length) {
    await prisma.messageLog.deleteMany({ where: { leadId: { in: cleanIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: cleanIds } } });
  }
  await prisma.$disconnect();

  console.log("Stats :", stats);
  console.log("✔ Lead marketing créé localement :", Boolean(marketingLead));
  console.log("✔ Lead réception NON créé localement :", !receptionLead);
  console.log("✔ Payloads transférés au réceptionniste :", forwarded.length);
  console.log(
    "✔ Contenu transféré :",
    JSON.stringify(forwarded.map((p) => p.body?.entry?.[0]?.changes?.[0]?.value?.messages?.map((m) => m.text.body))),
  );
  console.log("✔ Header x-forwarded-by :", forwarded[0]?.headers?.["x-forwarded-by"]);

  server.close();
  process.exit(0);
})();
