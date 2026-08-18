"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
exports.emailTemplate = emailTemplate;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = require("../config");
/**
 * Transport email (SMTP) — la journalisation des messages est assurée
 * par le module `messaging.ts` (MessageLog multicanal).
 * En mode démo, les emails sont loggés en console.
 */
let transporter = null;
function getTransporter() {
    if (config_1.config.demoMode)
        return null;
    if (transporter)
        return transporter;
    if (!config_1.config.email.host || !config_1.config.email.user)
        return null;
    transporter = nodemailer_1.default.createTransport({
        host: config_1.config.email.host,
        port: config_1.config.email.port,
        secure: config_1.config.email.port === 465,
        auth: { user: config_1.config.email.user, pass: config_1.config.email.pass },
    });
    return transporter;
}
async function sendEmail(input) {
    const t = getTransporter();
    if (!t) {
        console.log(`[email][demo] À ${input.to} — Sujet : ${input.subject}`);
        return { sent: true, demo: true };
    }
    await t.sendMail({
        from: config_1.config.email.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
    });
    return { sent: true, demo: false };
}
const STYLE = "font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;";
const BUTTON = "display:inline-block;background:#b8860b;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;";
const SITE = config_1.config.hotel.website || "#";
function emailTemplate(kind, vars = {}) {
    const hotel = config_1.config.hotel.name;
    const name = vars.name ? ` ${vars.name}` : "";
    const offer = vars.offer ?? "10% de remise";
    switch (kind) {
        case "welcome":
            return {
                subject: `Merci${name} ! Votre séjour à ${hotel} vous attend 🌅`,
                html: `<div style="${STYLE}"><h2 style="color:#0f1f3d;">Bienvenue chez ${hotel}</h2><p>Bonjour${name},</p><p>Merci pour votre intérêt pour ${hotel}. ${config_1.config.hotel.tagline}.</p><p>Réservez dès aujourd'hui pour profiter de nos meilleurs tarifs.</p><p><a href="${SITE}" style="${BUTTON}">Réserver mon séjour</a></p><p>À très vite,<br/>L'équipe ${hotel}</p></div>`,
            };
        case "followup1":
            return {
                subject: `Votre escapade à ${hotel} est toujours disponible ✨`,
                html: `<div style="${STYLE}"><h2 style="color:#0f1f3d;">Votre chambre vous attend</h2><p>Bonjour${name},</p><p>Nous gardons votre chambre au chaud ! Bénéficiez de ${offer} si vous réservez sous 48h.</p><p><a href="${SITE}" style="${BUTTON}">Profiter de l'offre</a></p><p>L'équipe ${hotel}</p></div>`,
            };
        case "followup2":
            return {
                subject: `Dernière chance : offre exclusive ${hotel} 🏨`,
                html: `<div style="${STYLE}"><h2 style="color:#0f1f3d;">Dernière chance</h2><p>Bonjour${name},</p><p>Notre offre exclusive expire bientôt : ${offer}, annulation flexible et petit-déjeuner inclus.</p><p><a href="${SITE}" style="${BUTTON}">Réserver maintenant</a></p><p>L'équipe ${hotel}</p></div>`,
            };
        default:
            return {
                subject: `Une offre rien que pour vous — ${hotel}`,
                html: `<div style="${STYLE}"><h2 style="color:#0f1f3d;">Une offre rien que pour vous</h2><p>Bonjour${name},</p><p>Découvrez nos offres du moment à ${hotel} : ${offer}.</p><p><a href="${SITE}" style="${BUTTON}">Découvrir</a></p><p>L'équipe ${hotel}</p></div>`,
            };
    }
}
//# sourceMappingURL=email.js.map