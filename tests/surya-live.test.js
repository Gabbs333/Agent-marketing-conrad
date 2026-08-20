// Test réel : Surya (persona + LLM), scoring des leads, escalade situationnelle.
process.env.DEMO_MODE = "false";
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/hotel_marketing_test";

const root = "/Volumes/Extension Native Data System/Agent marketing hotel";
const { PrismaClient } = require(root + "/node_modules/@prisma/client");
const { scoreLead } = require(root + "/dist/inbound/scoring.js");
const {
  analyzeInbound,
  needsHumanEscalation,
  escalationMessage,
} = require(root + "/dist/content/chatReply.js");

(async () => {
  const prisma = new PrismaClient();

  // 1. Lead avec historique d'intention forte
  const lead = await prisma.lead.create({
    data: { phone: "33699999999", source: "whatsapp", status: "replied" },
  });
  for (const [i, text] of [
    "Bonjour, je voudrais réserver une suite",
    "Combien coûte le week-end prochain ?",
    "Quelles sont vos disponibilités pour 2 nuits ?",
  ].entries()) {
    await prisma.messageLog.create({
      data: {
        leadId: lead.id,
        channel: "whatsapp",
        direction: "inbound",
        status: "received",
        subject: text,
        externalId: `test-surya-${i}`,
        sentAt: new Date(),
      },
    });
  }

  // 2. Scoring
  const { score, temperature } = await scoreLead(lead.id);
  console.log(`Scoring : ${score}/100 → ${temperature}`);

  // 3. Réponse IA (Surya) pour un lead chaud
  const a1 = await analyzeInbound(
    "Pouvez-vous me confirmer vos disponibilités pour le week-end prochain ?",
    lead.id,
    temperature,
  );
  console.log("\n── RÉPONSE DE SURYA (lead tiède) ──\n[escalate:", a1.escalate + "]", a1.reply);

  // 4. Escalade situationnelle : frustration, sans demande explicite d'humain
  const a2 = await analyzeInbound(
    "C'est la troisième fois que je vous le demande et personne ne me répond. C'est inadmissible, je vais annuler mon séjour !",
    lead.id,
    "hot",
  );
  console.log("\n── ESCALADE SITUATIONNELLE (colère) ──\n[escalate:", a2.escalate + "]");
  if (a2.escalate) console.log("Message d'escalade :", escalationMessage());

  // 5. Escalade explicite (chemin déterministe)
  console.log("\n── ESCALADE EXPLICITE ──");
  console.log("needsHumanEscalation('je veux parler à un humain') :", needsHumanEscalation("je veux parler à un humain"));

  // Nettoyage
  await prisma.messageLog.deleteMany({ where: { leadId: lead.id } });
  await prisma.lead.deleteMany({ where: { id: lead.id } });
  await prisma.$disconnect();
  process.exit(0);
})();
