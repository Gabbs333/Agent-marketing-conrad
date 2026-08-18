"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendText = sendText;
exports.requestOneTimeNotification = requestOneTimeNotification;
exports.sendOneTimeNotification = sendOneTimeNotification;
exports.buildRefUrl = buildRefUrl;
const config_1 = require("../config");
const http_1 = require("../lib/http");
/**
 * Messenger (Meta Send API) :
 *  - messages texte (messaging_type RESPONSE, fenêtre de 24 h) ;
 *  - notifications uniques (One-Time Notification) pour recontacter
 *    un utilisateur après la fenêtre de 24 h, avec son accord ;
 *  - lien m.me avec paramètre ref pour capturer la campagne source.
 */
const GRAPH_URL = "https://graph.facebook.com/v20.0";
function demo(message) {
    console.log(`[messenger][demo] ${message}`);
    return { sent: true, demo: true, messageId: `demo_msg_${Date.now()}` };
}
function requireConfig() {
    const pageId = config_1.config.messenger.pageId;
    const token = config_1.config.messenger.pageToken;
    if (!pageId || !token) {
        throw new Error("FB_PAGE_ID et FB_PAGE_TOKEN manquants pour Messenger");
    }
    return { pageId, token };
}
/** Message texte simple (dans la fenêtre de 24 h). */
async function sendText(input) {
    if (config_1.config.demoMode) {
        return demo(`Texte → ${input.psid} : ${input.text.slice(0, 80)}`);
    }
    const { token } = requireConfig();
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/me/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            recipient: { id: input.psid },
            messaging_type: "RESPONSE",
            message: { text: input.text },
        }),
    });
    return { sent: true, demo: false, messageId: data.message_id };
}
/** Demande d'accord pour une notification unique (hors fenêtre 24 h). */
async function requestOneTimeNotification(input) {
    if (config_1.config.demoMode) {
        return demo(`Demande OTN → ${input.psid} (${input.title})`);
    }
    const { token } = requireConfig();
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/me/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            recipient: { id: input.psid },
            messaging_type: "RESPONSE",
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "one_time_notif_req",
                        title: input.title,
                        payload: input.payload,
                    },
                },
            },
        }),
    });
    return { sent: true, demo: false, messageId: data.message_id };
}
/** Envoi d'une notification unique (après accord de l'utilisateur). */
async function sendOneTimeNotification(input) {
    if (config_1.config.demoMode) {
        return demo(`Notification unique → ${input.psid} (${input.title})`);
    }
    const { token } = requireConfig();
    const data = await (0, http_1.httpJson)(`${GRAPH_URL}/me/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            recipient: { id: input.psid },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "one_time_notif_msg",
                        title: input.title,
                        payload: input.payload,
                    },
                },
            },
        }),
    });
    return { sent: true, demo: false, messageId: data.message_id };
}
/**
 * Lien m.me avec ref : quand l'utilisateur ouvre la conversation,
 * le webhook reçoit un `messaging_referrals` contenant le ref,
 * ce qui permet de créer le lead rattaché à la campagne.
 */
function buildRefUrl(campaignId) {
    const pageId = config_1.config.messenger.pageId || (config_1.config.demoMode ? "VOTRE_PAGE_ID" : "");
    if (!pageId) {
        throw new Error("FB_PAGE_ID manquant pour générer un lien m.me");
    }
    return `https://m.me/${pageId}?ref=campaign_${campaignId}`;
}
//# sourceMappingURL=messenger.js.map