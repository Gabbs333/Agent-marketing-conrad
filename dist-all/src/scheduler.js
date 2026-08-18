"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduler = startScheduler;
const leadCapture_1 = require("./inbound/leadCapture");
const pipeline_1 = require("./pipeline");
const calendar_1 = require("./content/calendar");
/**
 * Planificateur interne :
 *  - toutes les minutes : publication des posts planifiés arrivés à échéance ;
 *  - toutes les heures : génération des posts du calendrier éditorial
 *    et séquence d'emails de nurturing des leads ;
 *  - toutes les 6 heures : synchronisation des performances.
 */
function startScheduler() {
    const jobs = [];
    const run = (fn, label) => {
        fn().catch((err) => console.error(`[scheduler] ${label} :`, err));
    };
    run(pipeline_1.publishScheduledPosts, "publishScheduledPosts");
    jobs.push(setInterval(() => run(pipeline_1.publishScheduledPosts, "publishScheduledPosts"), 60_000));
    jobs.push(setInterval(() => run(() => (0, calendar_1.generateFromCalendar)(2), "generateFromCalendar"), 60 * 60 * 1000));
    jobs.push(setInterval(() => run(leadCapture_1.nurtureLeads, "nurtureLeads"), 60 * 60 * 1000));
    jobs.push(setInterval(() => run(pipeline_1.syncPerformance, "syncPerformance"), 6 * 60 * 60 * 1000));
    return () => jobs.forEach((j) => clearInterval(j));
}
//# sourceMappingURL=scheduler.js.map