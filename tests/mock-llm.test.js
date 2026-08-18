// Test de la chaîne LLM multi-fournisseurs avec un serveur mock
// au format exact de Groq (API compatible OpenAI).
process.env.DEMO_MODE = "false";
process.env.LLM_BASE_URL = "http://127.0.0.1:9999/v1";
process.env.LLM_API_KEY = "test-key";

const http = require("node:http");

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    console.log(
      "[mock] requête reçue → auth:",
      req.headers.authorization,
      "| model:",
      parsed.model,
      "| messages:",
      parsed.messages.length,
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                "✨ Suite Royale au Conrad Grand Luxury Hotel : un écrin de luxe face à la mer.\n\nProfitez d'un séjour d'exception, petit-déjeuner gastronomique inclus.\n\n👉 Réservez maintenant — lien en bio.\n\n#ConradGrandLuxury #Hotel #Luxe",
            },
          },
        ],
      }),
    );
  });
});

server.listen(9999, "127.0.0.1", async () => {
  const { resolveLlm } = require("/Volumes/Extension Native Data System/Agent marketing hotel/dist/content/llm.js");
  const { generatePostText } = require("/Volumes/Extension Native Data System/Agent marketing hotel/dist/content/textGenerator.js");

  console.log("Fournisseur résolu :", JSON.stringify(resolveLlm()));
  const text = await generatePostText({ platform: "facebook", topic: "Suite Royale" });
  console.log("\n── TEXTE GÉNÉRÉ ──\n" + text);

  server.close();
  process.exit(0);
});
