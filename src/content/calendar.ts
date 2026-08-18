import { prisma } from "../db";
import { generatePostText, generateVideoScript } from "./textGenerator";
import { generateCampaignVideo } from "./videoGenerator";
import { selectMediaForTopic } from "./mediaSelector";

/**
 * Calendrier éditorial : fréquence, horaires, thèmes et tons propres
 * à chaque plateforme. L'agent génère automatiquement les posts
 * planifiés (texte + médias adaptés) à partir de ces créneaux.
 */

export interface PlatformStyle {
  name: string;
  frequency: string;
  bestTimes: string;
  tone: string;
  formats: string[];
  tips: string;
}

export const PLATFORM_STYLES: Record<string, PlatformStyle> = {
  facebook: {
    name: "Facebook",
    frequency: "3 à 4 publications / semaine",
    bestTimes: "9h – 11h et 17h – 19h",
    tone: "Chaleureux, storytelling, élégant — preuves sociales et CTA réservation",
    formats: ["Post photo + texte", "Post texte + lien", "Événement"],
    tips: "Mettre en avant les avis et notes, terminer par un appel à l'action vers la réservation.",
  },
  tiktok: {
    name: "TikTok",
    frequency: "3 vidéos / semaine",
    bestTimes: "17h – 20h",
    tone: "Dynamique, immersif, tendance — accroche en 2 secondes, sous-titres systématiques",
    formats: ["Vidéo 9:16 (15-30 s)", "Visite de suite", "ASMR spa", "Vue au coucher du soleil"],
    tips: "Toujours vertical, hashtags voyage tendance, CTA direct en fin de vidéo.",
  },
};

const DEFAULT_SLOTS = [
  { platform: "facebook", dayOfWeek: 1, time: "10:00", type: "text", topic: "La vie au Conrad — ambiance & design", tone: "chaleureux et élégant" },
  { platform: "facebook", dayOfWeek: 3, time: "18:00", type: "photo", topic: "Gastronomie : la carte du chef", tone: "gourmand et raffiné" },
  { platform: "facebook", dayOfWeek: 5, time: "09:00", type: "text", topic: "Offre du week-end", tone: "incitatif et élégant" },
  { platform: "tiktok", dayOfWeek: 2, time: "19:00", type: "video", topic: "Visite express d'une suite", tone: "dynamique et immersif" },
  { platform: "tiktok", dayOfWeek: 4, time: "19:00", type: "video", topic: "Spa & détente — immersion sensorielle", tone: "relaxant et sensoriel" },
  { platform: "tiktok", dayOfWeek: 6, time: "17:00", type: "video", topic: "Vue panoramique au coucher du soleil", tone: "poétique et cinématographique" },
];

export const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** Calendrier + guide de style. Les créneaux par défaut sont créés au premier appel. */
export async function getCalendar(): Promise<{ slots: any[]; styles: Record<string, PlatformStyle> }> {
  let slots = await prisma.calendarSlot.findMany({
    orderBy: [{ dayOfWeek: "asc" }, { time: "asc" }],
  });
  if (slots.length === 0) {
    await prisma.calendarSlot.createMany({ data: DEFAULT_SLOTS });
    slots = await prisma.calendarSlot.findMany({
      orderBy: [{ dayOfWeek: "asc" }, { time: "asc" }],
    });
  }
  return { slots, styles: PLATFORM_STYLES };
}

export interface SlotInput {
  id?: string;
  platform: string;
  dayOfWeek: number;
  time: string;
  type: string;
  topic: string;
  tone?: string;
  enabled?: boolean;
}

export async function upsertSlot(input: SlotInput): Promise<any> {
  if (input.platform !== "facebook" && input.platform !== "tiktok") {
    throw new Error("Plateforme inconnue (facebook | tiktok)");
  }
  if (input.dayOfWeek < 1 || input.dayOfWeek > 7) {
    throw new Error("dayOfWeek doit être entre 1 (lundi) et 7 (dimanche)");
  }
  if (!/^\d{2}:\d{2}$/.test(input.time)) {
    throw new Error("time doit être au format HH:MM");
  }
  const data = {
    platform: input.platform,
    dayOfWeek: input.dayOfWeek,
    time: input.time,
    type: input.type,
    topic: input.topic,
    tone: input.tone ?? null,
    enabled: input.enabled ?? true,
  };
  if (input.id) {
    return prisma.calendarSlot.update({ where: { id: input.id }, data });
  }
  return prisma.calendarSlot.create({ data });
}

export async function deleteSlot(id: string): Promise<void> {
  await prisma.calendarSlot.delete({ where: { id } });
}

/**
 * Génère les posts planifiés des `days` prochains jours à partir du
 * calendrier : texte adapté à la plateforme (Groq ou gabarits),
 * image/vidéo choisie dans la médiathèque pour les créneaux photo/vidéo.
 * Idempotent : chaque créneau ne génère qu'un post par date.
 */
export async function generateFromCalendar(days = 7): Promise<{ created: number; posts: any[] }> {
  // Initialise les créneaux par défaut si le calendrier est vide
  const { slots: allSlots } = await getCalendar();
  const slots = allSlots.filter((s: any) => s.enabled);
  const now = new Date();
  const created: any[] = [];

  for (const slot of slots) {
    for (let d = 0; d < days; d++) {
      const date = new Date(now);
      date.setDate(now.getDate() + d);
      const dow = ((date.getDay() + 6) % 7) + 1; // 1 = lundi
      if (dow !== slot.dayOfWeek) continue;

      const occ = new Date(date);
      const [hh, mm] = slot.time.split(":").map(Number);
      occ.setHours(hh, mm, 0, 0);
      if (occ.getTime() <= now.getTime()) continue;

      const dayStart = new Date(occ); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(occ); dayEnd.setHours(23, 59, 59, 999);
      const existing = await prisma.post.findFirst({
        where: { calendarSlotId: slot.id, scheduledAt: { gte: dayStart, lte: dayEnd } },
      });
      if (existing) continue;

      const text = await generatePostText({
        platform: slot.platform,
        topic: slot.topic,
        tone: slot.tone ?? undefined,
      });

      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let postType = slot.type;

      if (slot.type === "photo") {
        const images = await selectMediaForTopic(slot.topic, 1);
        if (images.length > 0) {
          mediaUrl = images[0].url;
          mediaType = "image";
        }
      } else if (slot.type === "video") {
        try {
          const script = await generateVideoScript({ topic: slot.topic, durationSec: 15 });
          const images = await selectMediaForTopic(slot.topic, 4);
          const video = await generateCampaignVideo({
            script,
            images: images.map((i) => i.localPath),
          });
          mediaUrl = video.url;
          mediaType = "video";
        } catch (err) {
          console.error(`[calendar] Vidéo impossible pour « ${slot.topic} » :`, err);
          postType = "text";
        }
      }

      const post = await prisma.post.create({
        data: {
          platform: slot.platform,
          type: postType,
          text,
          mediaUrl,
          mediaType,
          status: "scheduled",
          scheduledAt: occ,
          calendarSlotId: slot.id,
        },
      });
      created.push(post);
    }
  }
  return { created: created.length, posts: created };
}
