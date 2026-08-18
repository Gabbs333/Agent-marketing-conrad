import { nurtureLeads } from "./inbound/leadCapture";
import { publishScheduledPosts, syncPerformance } from "./pipeline";
import { generateFromCalendar } from "./content/calendar";

/**
 * Planificateur interne :
 *  - toutes les minutes : publication des posts planifiés arrivés à échéance ;
 *  - toutes les heures : génération des posts du calendrier éditorial
 *    et séquence d'emails de nurturing des leads ;
 *  - toutes les 6 heures : synchronisation des performances.
 */
export function startScheduler(): () => void {
  const jobs: NodeJS.Timeout[] = [];
  const run = (fn: () => Promise<unknown>, label: string) => {
    fn().catch((err) => console.error(`[scheduler] ${label} :`, err));
  };

  run(publishScheduledPosts, "publishScheduledPosts");
  jobs.push(setInterval(() => run(publishScheduledPosts, "publishScheduledPosts"), 60_000));
  jobs.push(setInterval(() => run(() => generateFromCalendar(2), "generateFromCalendar"), 60 * 60 * 1000));
  jobs.push(setInterval(() => run(nurtureLeads, "nurtureLeads"), 60 * 60 * 1000));
  jobs.push(setInterval(() => run(syncPerformance, "syncPerformance"), 6 * 60 * 60 * 1000));

  return () => jobs.forEach((j) => clearInterval(j));
}
