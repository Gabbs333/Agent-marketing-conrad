/**
 * Tons éditoriaux disponibles par campagne.
 * Utilisés par le mini-éditeur de ton et transmis au LLM
 * pour adapter le style de tous les contenus générés.
 */
export interface TonePreset {
  id: string;
  label: string;
  description: string;
}

export const TONE_PRESETS: TonePreset[] = [
  { id: "chaleureux et incitatif", label: "Chaleureux", description: "Accueillant, humain, orienté réservation" },
  { id: "luxueux et exclusif", label: "Luxe", description: "Élégant, feutré, vocabulaire de palace" },
  { id: "minimaliste et épuré", label: "Minimaliste", description: "Phrases courtes, sobriété, blancs" },
  { id: "dynamique et énergique", label: "Dynamique", description: "Rythme rapide, énergie, tendances" },
  { id: "raffiné et gastronomique", label: "Gastronomique", description: "Sensoriel, saveurs, art de la table" },
  { id: "romantique et poétique", label: "Romantique", description: "Émotion, lenteur, imaginaire" },
  { id: "léger et humoristique", label: "Humoristique", description: "Clin d'œil, légèreté, complicité" },
  { id: "urgent et exclusif", label: "Urgence", description: "Offre limitée, rareté, CTA fort" },
];

export function getTonePreset(id: string | null | undefined): TonePreset | undefined {
  if (!id) return undefined;
  return TONE_PRESETS.find((t) => t.id === id);
}
