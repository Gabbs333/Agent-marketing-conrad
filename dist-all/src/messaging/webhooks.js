"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWebhookEvent = handleWebhookEvent;
const leadCapture_1 = require("../inbound/leadCapture");
async function handleWebhookEvent(body) {
    const entries = body?.entry ?? [];
    let events = 0;
    for (const entry of entries) {
        // WhatsApp : changes[].value.messages[]
        for (const change of entry.changes ?? []) {
            if (change.field !== "messages")
                continue;
            for (const msg of change.value?.messages ?? []) {
                const phone = msg.from;
                if (!phone || msg.type !== "text")
                    continue;
                try {
                    await (0, leadCapture_1.handleInboundMessage)({
                        channel: "whatsapp",
                        senderId: String(phone),
                        text: msg.text?.body ?? "",
                    });
                    events++;
                }
                catch (err) {
                    console.error("[webhook] WhatsApp entrant non traité :", err);
                }
            }
        }
        // Messenger : entry.messaging[]
        for (const event of entry.messaging ?? []) {
            const psid = event.sender?.id;
            if (!psid)
                continue;
            try {
                if (event.message?.text) {
                    await (0, leadCapture_1.handleInboundMessage)({
                        channel: "messenger",
                        senderId: String(psid),
                        text: event.message.text,
                    });
                    events++;
                }
                else if (event.messaging_referrals || event.referral) {
                    const ref = event.messaging_referrals?.[0]?.ref ?? event.referral?.ref ?? "";
                    await (0, leadCapture_1.handleReferral)({
                        psid: String(psid),
                        ref,
                        name: event.sender?.name,
                    });
                    events++;
                }
                else if (event.messaging_optins) {
                    await (0, leadCapture_1.handleReferral)({
                        psid: String(psid),
                        ref: event.messaging_optins?.ref ?? "",
                    });
                    events++;
                }
            }
            catch (err) {
                console.error("[webhook] Événement Messenger non traité :", err);
            }
        }
    }
    return { events };
}
//# sourceMappingURL=webhooks.js.map