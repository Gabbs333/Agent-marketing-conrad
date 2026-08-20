"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEEKDAYS = exports.PLATFORM_STYLES = void 0;
exports.getCalendar = getCalendar;
exports.upsertSlot = upsertSlot;
exports.deleteSlot = deleteSlot;
exports.generateFromCalendar = generateFromCalendar;
const db_1 = require("../db");
const textGenerator_1 = require("./textGenerator");
const videoGenerator_1 = require("./videoGenerator");
const mediaSelector_1 = require("./mediaSelector");
exports.PLATFORM_STYLES = {
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
exports.WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
/** Calendrier + guide de style. Les créneaux par défaut sont créés au premier appel. */
async function getCalendar() {
    let slots = await db_1.prisma.calendarSlot.findMany({
        orderBy: [{ dayOfWeek: "asc" }, { time: "asc" }],
    });
    if (slots.length === 0) {
        await db_1.prisma.calendarSlot.createMany({ data: DEFAULT_SLOTS });
        slots = await db_1.prisma.calendarSlot.findMany({
            orderBy: [{ dayOfWeek: "asc" }, { time: "asc" }],
        });
    }
    return { slots, styles: exports.PLATFORM_STYLES };
}
async function upsertSlot(input) {
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
        return db_1.prisma.calendarSlot.update({ where: { id: input.id }, data });
    }
    return db_1.prisma.calendarSlot.create({ data });
}
async function deleteSlot(id) {
    await db_1.prisma.calendarSlot.delete({ where: { id } });
}
/**
 * Génère les posts planifiés des `days` prochains jours à partir du
 * calendrier : texte adapté à la plateforme (Groq ou gabarits),
 * image/vidéo choisie dans la médiathèque pour les créneaux photo/vidéo.
 * Idempotent : chaque créneau ne génère qu'un post par date.
 */
async function generateFromCalendar(days = 7) {
    // Initialise les créneaux par défaut si le calendrier est vide
    const { slots: allSlots } = await getCalendar();
    const slots = allSlots.filter((s) => s.enabled);
    const now = new Date();
    const created = [];
    for (const slot of slots) {
        for (let d = 0; d < days; d++) {
            const date = new Date(now);
            date.setDate(now.getDate() + d);
            const dow = ((date.getDay() + 6) % 7) + 1; // 1 = lundi
            if (dow !== slot.dayOfWeek)
                continue;
            const occ = new Date(date);
            const [hh, mm] = slot.time.split(":").map(Number);
            occ.setHours(hh, mm, 0, 0);
            if (occ.getTime() <= now.getTime())
                continue;
            const dayStart = new Date(occ);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(occ);
            dayEnd.setHours(23, 59, 59, 999);
            const existing = await db_1.prisma.post.findFirst({
                where: { calendarSlotId: slot.id, scheduledAt: { gte: dayStart, lte: dayEnd } },
            });
            if (existing)
                continue;
            const text = await (0, textGenerator_1.generatePostText)({
                platform: slot.platform,
                topic: slot.topic,
                tone: slot.tone ?? undefined,
            });
            let mediaUrl = null;
            let mediaType = null;
            let postType = slot.type;
            if (slot.type === "photo") {
                const images = await (0, mediaSelector_1.selectMediaForTopic)(slot.topic, 1);
                if (images.length > 0) {
                    mediaUrl = images[0].url;
                    mediaType = "image";
                }
            }
            else if (slot.type === "video") {
                try {
                    const script = await (0, textGenerator_1.generateVideoScript)({ topic: slot.topic, durationSec: 15 });
                    const images = await (0, mediaSelector_1.selectMediaForTopic)(slot.topic, 4);
                    const video = await (0, videoGenerator_1.generateCampaignVideo)({
                        script,
                        images: images.map((i) => i.localPath),
                    });
                    mediaUrl = video.url;
                    mediaType = "video";
                }
                catch (err) {
                    console.error(`[calendar] Vidéo impossible pour « ${slot.topic} » :`, err);
                    postType = "text";
                }
            }
            const post = await db_1.prisma.post.create({
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
//# sourceMappingURL=calendar.js.map