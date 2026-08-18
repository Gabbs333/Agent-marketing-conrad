import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.contentTemplate.createMany({
    data: [
      {
        name: "Post Facebook — Offre week-end",
        platform: "facebook",
        type: "text",
        prompt:
          "Écris un post Facebook annonçant une offre week-end à -20% avec petit-déjeuner inclus.",
      },
      {
        name: "Vidéo TikTok — Visite express",
        platform: "tiktok",
        type: "video",
        prompt:
          "Scénario d'une visite express de 15 secondes de l'hôtel : chambre, spa, rooftop.",
      },
      {
        name: "Email — Relance séjour",
        platform: "email",
        type: "email",
        prompt:
          "Email de relance pour un lead qui n'a pas encore réservé, avec une remise de 10% limitée à 48h.",
      },
    ],
  });
  console.log("✅ Templates de contenu créés.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
