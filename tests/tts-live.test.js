// Test réel : TTS multi-fournisseurs + montage vidéo avec voix off (Groq Orpheus).
process.env.DEMO_MODE = "false";

const root = "/Volumes/Extension Native Data System/Agent marketing hotel";
const { ttsAvailable, resolveTts, textToSpeech } = require(root + "/dist/content/tts.js");
const {
  generateVideoFromScript,
} = require(root + "/dist/content/videoGenerator.js");
const { PrismaClient } = require(root + "/node_modules/@prisma/client");

(async () => {
  console.log("TTS disponible :", ttsAvailable(), "| résolution :", resolveTts()?.provider, "/", resolveTts()?.voice);

  // 1. Voix off simple (peut échouer tant que les conditions Orpheus ne sont pas acceptées)
  try {
    const vo = await textToSpeech(
      "Welcome to the Conrad Grand Luxury Hotel.",
      { filename: "test-vo-groq.wav" },
    );
    console.log("Voix off générée :", vo);
  } catch (err) {
    console.log("TTS direct KO (attendu tant que les conditions Orpheus ne sont pas acceptées) :", String(err).slice(0, 300));
  }

  // 2. Montage complet — voix off auto : doit se replier proprement sans narration
  const prisma = new PrismaClient();
  const assets = await prisma.mediaAsset.findMany({
    where: { type: "image", localPath: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  await prisma.$disconnect();
  const images = assets.map((a) => a.localPath);
  console.log("Images utilisées :", images.length);

  const video = await generateVideoFromScript({
    script: {
      title: "Week-end romantique au Conrad",
      hook: "Et si votre week-end devenait inoubliable ?",
      scenes: [
        { visual: "Suite Royale baignée de lumière dorée", narration: "Réveillez-vous dans une suite baignée de lumière dorée.", durationSec: 4 },
        { visual: "Spa et détente", narration: "Offrez-vous un moment de pure détente au spa.", durationSec: 4 },
        { visual: "Dîner gastronomique aux chandelles", narration: "Savourez un dîner gastronomique signé par notre chef.", durationSec: 4 },
      ],
      cta: "Réservez dès maintenant sur notre site.",
    },
    images,
  }).catch((err) => ({ error: String(err) }));
  console.log("Montage vidéo :", video);
  process.exit(0);
})();
