// Test de génération réelle avec Groq (clé dans .env).
process.env.DEMO_MODE = "false";

const { resolveLlm } = require("/Volumes/Extension Native Data System/Agent marketing hotel/dist/content/llm.js");
const {
  generatePostText,
  generateVideoScript,
  generateAdCopy,
} = require("/Volumes/Extension Native Data System/Agent marketing hotel/dist/content/textGenerator.js");

(async () => {
  const llm = resolveLlm();
  console.log("Fournisseur actif :", llm?.label, "| modèle :", llm?.model);

  const fb = await generatePostText({
    platform: "facebook",
    topic: "Ouverture de la terrasse panoramique",
  });
  console.log("\n── POST FACEBOOK ──\n" + fb);

  const tt = await generatePostText({
    platform: "tiktok",
    topic: "Suite Royale au coucher du soleil",
  });
  console.log("\n── CAPTION TIKTOK ──\n" + tt);

  const script = await generateVideoScript({
    topic: "Week-end romantique",
    durationSec: 15,
  });
  console.log(
    "\n── SCRIPT VIDÉO ──\n" +
      script.hook +
      "\n" +
      script.scenes.map((s) => `• ${s.visual} (${s.durationSec}s) : ${s.narration}`).join("\n") +
      "\nCTA : " +
      script.cta,
  );

  const ad = await generateAdCopy({ objective: "conversions", offer: "-20% sur les suites" });
  console.log("\n── COPY PUBLICITAIRE ──\n" + JSON.stringify(ad, null, 2));

  process.exit(0);
})();
