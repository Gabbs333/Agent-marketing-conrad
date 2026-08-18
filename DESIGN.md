---
name: Conrad Luxury
description: Identité visuelle de l'agent marketing du Conrad Grand Luxury Hotel — palace contemporain, nuit profonde et or champagne.
colors:
  primary: "#0B1626"
  primary-deep: "#070F1C"
  secondary: "#12233D"
  accent: "#C9A25E"
  accent-soft: "#EAD9AE"
  surface: "#F7F3EB"
  card: "#FFFFFF"
  ink: "#1A2433"
  muted: "#8A93A3"
  line: "#E9E2D4"
  success: "#1E7A46"
  danger: "#B3382C"
  warning: "#B7791F"
typography:
  display:
    fontFamily: "Playfair Display"
    fontSize: 2rem
    fontWeight: 600
    lineHeight: 1.15
  h2:
    fontFamily: "Playfair Display"
    fontSize: 1.35rem
    fontWeight: 600
  body:
    fontFamily: "Inter"
    fontSize: 0.95rem
    lineHeight: 1.55
  label-caps:
    fontFamily: "Inter"
    fontSize: 0.72rem
    letterSpacing: 0.08em
  metric:
    fontFamily: "Playfair Display"
    fontSize: 1.9rem
    fontWeight: 700
rounded:
  sm: 8px
  md: 12px
  lg: 18px
  xl: 24px
spacing:
  xs: 6px
  sm: 10px
  md: 16px
  lg: 24px
  xl: 40px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.primary}"
  sidebar:
    backgroundColor: "{colors.primary-deep}"
    textColor: "#93A0B4"
  sidebar-active:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.accent-soft}"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
---

## Overview

Palace contemporain : nuit profonde (navy) pour la structure et la
navigation, or champagne pour les interactions et les accents,
ivoire chaud pour la zone de travail. L'ensemble doit évoquer un
établissement de luxe — sobre, spacieux, avec une typographie
éditoriale (serif pour les titres et les chiffres) et des
micro-interactions douces (fondu, levée au survol, toasts).

## Colors

- **Primary (#0B1626)** : encre nuit pour les textes et les surfaces structurantes.
- **Primary deep (#070F1C)** : sidebar et fonds sombres.
- **Accent (#C9A25E)** : or champagne — unique moteur d'interaction (boutons, états actifs, badges).
- **Surface (#F7F3EB)** : ivoire chaud, fond général, jamais blanc pur.
- **Ink (#1A2433)** : texte principal.
- **Muted (#8A93A3)** : métadonnées, légendes, bordures.
- **Line (#E9E2D4)** : séparateurs subtils.
- Semantic : success #1E7A46, danger #B3382C, warning #B7791F.

## Typography

- **Playfair Display** : titres, chiffres de KPI, branding — caractère palace.
- **Inter** : corps de texte, tableaux, contrôles — lisibilité numérique.
- Libellés en capitales espacées (`label-caps`) pour les en-têtes de tableaux.

## Layout

Sidebar sombre fixe (240px) + zone de contenu ivoire. Contenu centré
max 1280px, respiration généreuse (24px+), cartes arrondies 18px avec
ombre douce. Sur mobile, la sidebar devient une barre horizontale.

## Elevation & Depth

Cartes : `0 1px 2px rgba(7,15,28,.06), 0 10px 30px rgba(7,15,28,.06)`.
Survol des cartes KPI : élévation + levée de 2px. Modales : fond
flouté `backdrop-filter: blur(6px)`, panneau blanc 20px.

## Shapes

Radiis généreux mais maîtrisés : 8px boutons, 12px champs, 18px cartes,
24px modales. Pastilles de statut avec point coloré.

## Components

- **button-primary** : dégradé or (linear-gradient 135deg #D9B36A → #C9A25E), texte navy, hover éclairci.
- **sidebar** : fond nuit profonde, item actif avec barre or à gauche et fond navy secondaire.
- **badges** : pastille ivoire avec point sémantique ; états : ok (vert), warn (ambre), err (rouge), neutre (slate).
- **toasts** : pilule navy avec icône or, glissement depuis la droite, auto-dismiss 4 s.
- **modale** : titre serif, animation montante, fermeture par Échap ou clic sur le fond.
- **tableaux** : en-têtes en capitales espacées, survol ivoire, badge de statut.

## Do's and Don'ts

- **Do** : laisser respirer (espacement 16-24px), or uniquement pour l'interaction, serif pour les chiffres clés, états vides illustrés avec CTA.
- **Don't** : pas de couleurs vives saturées hors sémantique, pas d'ombres dures, pas de bordures épaisses, pas plus de deux familles de polices.
