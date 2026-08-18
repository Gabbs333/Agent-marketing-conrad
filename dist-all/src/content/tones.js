"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TONE_PRESETS = void 0;
exports.getTonePreset = getTonePreset;
exports.TONE_PRESETS = [
    { id: "chaleureux et incitatif", label: "Chaleureux", description: "Accueillant, humain, orienté réservation" },
    { id: "luxueux et exclusif", label: "Luxe", description: "Élégant, feutré, vocabulaire de palace" },
    { id: "minimaliste et épuré", label: "Minimaliste", description: "Phrases courtes, sobriété, blancs" },
    { id: "dynamique et énergique", label: "Dynamique", description: "Rythme rapide, énergie, tendances" },
    { id: "raffiné et gastronomique", label: "Gastronomique", description: "Sensoriel, saveurs, art de la table" },
    { id: "romantique et poétique", label: "Romantique", description: "Émotion, lenteur, imaginaire" },
    { id: "léger et humoristique", label: "Humoristique", description: "Clin d'œil, légèreté, complicité" },
    { id: "urgent et exclusif", label: "Urgence", description: "Offre limitée, rareté, CTA fort" },
];
function getTonePreset(id) {
    if (!id)
        return undefined;
    return exports.TONE_PRESETS.find((t) => t.id === id);
}
//# sourceMappingURL=tones.js.map