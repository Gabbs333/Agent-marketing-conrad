"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWebhookEvent = handleWebhookEvent;
const leadCapture_1 = require("../inbound/leadCapture");
const router_1 = require("./router");
async function handleWebhookEvent(body) {
    const entries = body?.entry ?? [];
    let events = 0;
    let forwarded = 0;
    const routing = (0, router_1.routerEnabled)();
    for (const entry of entries) {
        // ── WhatsApp : changes[].value.messages[] ──
        for (const change of entry.changes ?? []) {
            if (change.field !== "messages")
                continue;
            const hasAdContext = Boolean(change.value?.ad_id);
            const messages = change.value?.messages ?? [];
            const local = [];
            const delegate = [];
            if (routing) {
                for (const msg of messages) {
                    const phone = msg.from;
                    if (!phone)
                        continue;
                    const verdict = msg.type === "text"
                        ? await (0, router_1.classifyMessage)({
                            channel: "whatsapp",
                            senderId: String(phone),
                            text: msg.text?.body ?? "",
                            hasAdContext,
                        })
                        : "reception"; // médias entrants → réceptionniste par défaut
                    (verdict === "marketing" ? local : delegate).push(msg);
                }
            }
            else {
                local.push(...messages);
            }
            for (const msg of local) {
                if (msg.type !== "text")
                    continue;
                try {
                    await (0, leadCapture_1.handleInboundMessage)({
                        channel: "whatsapp",
                        senderId: String(msg.from),
                        text: msg.text?.body ?? "",
                    });
                    events++;
                }
                catch (err) {
                    console.error("[webhook] WhatsApp entrant non traité :", err);
                }
            }
            if (delegate.length) {
                const ok = await (0, router_1.forwardToReceptionist)({
                    object: body.object,
                    entry: [{ ...entry, changes: [{ ...change, value: { ...change.value, messages: delegate } }] }],
                });
                if (ok) {
                    forwarded += delegate.length;
                }
                else {
                    // Filet de sécurité : réceptionniste indisponible → on traite ici
                    console.error("[router] Réceptionniste indisponible, prise en charge locale.");
                    for (const msg of delegate) {
                        if (msg.type !== "text")
                            continue;
                        try {
                            await (0, leadCapture_1.handleInboundMessage)({
                                channel: "whatsapp",
                                senderId: String(msg.from),
                                text: msg.text?.body ?? "",
                            });
                            events++;
                        }
                        catch (err) {
                            console.error("[webhook] WhatsApp (repli) non traité :", err);
                        }
                    }
                }
            }
        }
        // ── Messenger : entry.messaging[] ──
        const delegateEvents = [];
        for (const event of entry.messaging ?? []) {
            const psid = event.sender?.id;
            if (!psid)
                continue;
            let verdict = "marketing";
            if (routing) {
                if (event.message?.text) {
                    verdict = await (0, router_1.classifyMessage)({
                        channel: "messenger",
                        senderId: String(psid),
                        text: event.message.text,
                        hasAdContext: false,
                    });
                }
                else if (event.messaging_referrals || event.referral) {
                    const ref = event.messaging_referrals?.[0]?.ref ?? event.referral?.ref ?? "";
                    verdict = ref.startsWith("campaign_") ? "marketing" : "reception";
                }
                else if (event.messaging_optins) {
                    verdict = "marketing"; // opt-in = source marketing (plugin/ads)
                }
                else {
                    verdict = "reception"; // pièces jointes, etc. → réceptionniste
                }
            }
            if (verdict === "reception") {
                delegateEvents.push(event);
                continue;
            }
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
                    await (0, leadCapture_1.handleReferral)({ psid: String(psid), ref, name: event.sender?.name });
                    events++;
                }
                else if (event.messaging_optins) {
                    await (0, leadCapture_1.handleReferral)({ psid: String(psid), ref: event.messaging_optins?.ref ?? "" });
                    events++;
                }
            }
            catch (err) {
                console.error("[webhook] Événement Messenger non traité :", err);
            }
        }
        if (delegateEvents.length) {
            const ok = await (0, router_1.forwardToReceptionist)({
                object: body.object,
                entry: [{ ...entry, messaging: delegateEvents }],
            });
            if (ok) {
                forwarded += delegateEvents.length;
            }
            else {
                console.error("[router] Réceptionniste indisponible, événements Messenger ignorés :", delegateEvents.length);
            }
        }
    }
    return { events, forwarded };
}
//# sourceMappingURL=webhooks.js.map