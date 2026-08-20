"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNurtureMessage = sendNurtureMessage;
exports.sendAutoReply = sendAutoReply;
const config_1 = require("../config");
const db_1 = require("../db");
const messenger = __importStar(require("../messaging/messenger"));
const whatsapp = __importStar(require("../messaging/whatsapp"));
const email_1 = require("./email");
const STAGE_KIND = ["welcome", "followup1", "followup2", "offer"];
function firstName(lead) {
    return lead.name?.trim().split(/\s+/)[0] || "cher client";
}
function channelAvailable(channel, lead) {
    if (channel === "email")
        return !!lead.email;
    if (channel === "whatsapp")
        return !!lead.phone;
    return !!lead.messengerPsid;
}
function channelConfigured(channel) {
    if (config_1.config.demoMode)
        return true;
    if (channel === "email")
        return !!(config_1.config.email.host && config_1.config.email.user);
    if (channel === "whatsapp")
        return !!(config_1.config.whatsapp.phoneNumberId && config_1.config.whatsapp.accessToken);
    return !!(config_1.config.messenger.pageId && config_1.config.messenger.pageToken);
}
function messengerText(kind, name) {
    const hotel = config_1.config.hotel.name;
    const agent = config_1.config.agent.name;
    switch (kind) {
        case "welcome":
            return `Bonjour ${name} 👋 Je suis ${agent}, votre conseiller dédié à ${hotel} ! ${config_1.config.hotel.tagline}. Dites-moi vos dates de séjour, je vous réponds très vite.`;
        case "followup1":
            return `Bonjour ${name} ✨ Votre escapade à ${hotel} est toujours disponible. Réservez sous 48h et profitez de ${config_1.config.marketing.offer} !`;
        case "followup2":
            return `Dernière chance ${name} 🏨 ${config_1.config.marketing.offer} chez ${hotel}, annulation flexible et petit-déjeuner inclus. Réservez maintenant !`;
        default:
            return `Bonjour ${name} 🌅 Une offre rien que pour vous à ${hotel} : ${config_1.config.marketing.offer}. À très vite !`;
    }
}
async function logMessage(leadId, channel, subject, status, externalId, error) {
    await db_1.prisma.messageLog.create({
        data: {
            leadId,
            channel,
            subject: subject.slice(0, 500),
            status,
            externalId,
            sentAt: status === "sent" ? new Date() : null,
        },
    });
    if (error)
        console.error(`[messaging] Échec ${channel} (lead ${leadId}) :`, error);
}
function subjectFor(channel, stage, lead) {
    const kind = STAGE_KIND[Math.min(stage, STAGE_KIND.length - 1)];
    if (channel === "email")
        return (0, email_1.emailTemplate)(kind, { name: firstName(lead) }).subject;
    if (channel === "whatsapp") {
        const tpl = stage === 0
            ? config_1.config.whatsapp.templateWelcome
            : stage === 1
                ? config_1.config.whatsapp.templateFollowup
                : config_1.config.whatsapp.templateOffer;
        return `Template WhatsApp : ${tpl}`;
    }
    return `Messenger : ${messengerText(kind, firstName(lead)).slice(0, 80)}`;
}
async function dispatch(channel, stage, lead) {
    const kind = STAGE_KIND[Math.min(stage, STAGE_KIND.length - 1)];
    const name = firstName(lead);
    if (channel === "email") {
        const tpl = (0, email_1.emailTemplate)(kind, { name, offer: config_1.config.marketing.offer });
        const r = await (0, email_1.sendEmail)({ to: lead.email, subject: tpl.subject, html: tpl.html });
        return { sent: r.sent, demo: r.demo };
    }
    if (channel === "whatsapp") {
        const tplName = stage === 0
            ? config_1.config.whatsapp.templateWelcome
            : stage === 1
                ? config_1.config.whatsapp.templateFollowup
                : config_1.config.whatsapp.templateOffer;
        return whatsapp.sendTemplateMessage({
            to: lead.phone,
            template: tplName,
            params: [name, config_1.config.hotel.name, config_1.config.marketing.offer],
        });
    }
    return messenger.sendText({
        psid: lead.messengerPsid,
        text: messengerText(kind, name),
    });
}
/**
 * Envoie le message de l'étape `stage` sur le premier canal disponible
 * (ordre défini par NURTURE_CHANNELS), ou le canal forcé si précisé.
 */
async function sendNurtureMessage(lead, stage, forcedChannel) {
    const channels = forcedChannel ? [forcedChannel] : config_1.config.nurture.channels;
    const channel = channels.find((c) => channelAvailable(c, lead) && channelConfigured(c));
    if (!channel) {
        await logMessage(lead.id, "email", "Nurture", "failed", null, "Aucun canal disponible/configuré pour ce lead");
        return { channel: null, sent: false, demo: config_1.config.demoMode };
    }
    const subject = subjectFor(channel, stage, lead);
    try {
        const result = await dispatch(channel, stage, lead);
        await logMessage(lead.id, channel, subject, "sent", result.messageId ?? null);
        return { channel, sent: true, demo: result.demo };
    }
    catch (err) {
        await logMessage(lead.id, channel, subject, "failed", null, err.message);
        return { channel, sent: false, demo: false };
    }
}
/** Réponse automatique immédiate (fenêtre 24 h) après un message entrant.
 * `textOverride` : réponse IA contextuelle ; sinon gabarit de secours. */
async function sendAutoReply(lead, channel, textOverride) {
    const name = firstName(lead);
    const hotel = config_1.config.hotel.name;
    try {
        const text = textOverride ||
            (channel === "whatsapp"
                ? `Bonjour ${name} ! Je suis ${config_1.config.agent.name}, votre conseiller à ${hotel} ☀️ Dites-moi vos dates de séjour et je m'occupe du reste.`
                : `Bonjour ${name} ! Je suis ${config_1.config.agent.name}, votre conseiller à ${hotel} ☀️ Quelles dates vous intéressent ?`);
        const result = channel === "whatsapp"
            ? await whatsapp.sendTextMessage({ to: lead.phone, text })
            : await messenger.sendText({ psid: lead.messengerPsid, text });
        await logMessage(lead.id, channel, textOverride ? "Réponse IA" : "Réponse automatique", "sent", result.messageId ?? null);
        return { sent: true, demo: result.demo };
    }
    catch (err) {
        await logMessage(lead.id, channel, "Réponse automatique", "failed", null, err.message);
        return { sent: false, demo: false };
    }
}
//# sourceMappingURL=messaging.js.map