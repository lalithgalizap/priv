---
name: Cyber-Secure Glassmorphism
colors:
  surface: '#131316'
  surface-dim: '#131316'
  surface-bright: '#39393c'
  surface-container-lowest: '#0e0e11'
  surface-container-low: '#1b1b1e'
  surface-container: '#1f1f22'
  surface-container-high: '#2a2a2d'
  surface-container-highest: '#353438'
  on-surface: '#e4e1e6'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#e4e1e6'
  inverse-on-surface: '#303033'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ddb7ff'
  on-tertiary: '#490080'
  tertiary-container: '#b76dff'
  on-tertiary-container: '#400071'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#f0dbff'
  tertiary-fixed-dim: '#ddb7ff'
  on-tertiary-fixed: '#2c0051'
  on-tertiary-fixed-variant: '#6900b3'
  background: '#131316'
  on-background: '#e4e1e6'
  surface-variant: '#353438'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin: 32px
  container-max: 1440px
---

## Brand & Style
The design system is built on the concept of "Invisible Fortification." It targets a high-end cybersecurity audience that demands technical precision without sacrificing the "elite" aesthetic of modern developer tools. 

The style is a sophisticated blend of **Glassmorphism** and **Cyberpunk Minimalism**. It utilizes deep obsidian surfaces layered with frosted-glass panels to suggest depth and data opacity. The interface feels like a high-end command terminal viewed through a refined, HUD-inspired lens—secure, futuristic, and unshakeably stable.

## Colors
The palette is rooted in a "Deep Dark" foundation to reduce eye strain and emphasize glowing data points. 

- **Primary (Neon Indigo):** Used for critical UI actions, focus states, and primary navigation. It represents the "pulse" of the system.
- **Secondary (Emerald Green):** Dedicated strictly to "Success" states, system health, and secure encryption indicators.
- **Neutral (Zinc/Slate):** A range of greys used for borders, secondary text, and surface levels.
- **Background:** A near-black obsidian (#09090b) that allows glass layers to pop with maximum contrast.

## Typography
The typography strategy utilizes a dual-font system to separate "Interface" from "Data." 

**Hanken Grotesk** provides a clean, contemporary sans-serif feel for all functional UI elements, navigation, and marketing headlines. Its sharpness maintains a professional SaaS tone.

**JetBrains Mono** is reserved for technical data, hash strings, logs, and labels. This distinction cues the user that they are interacting with raw system information. Use `label-caps` for table headers and section titles to evoke a terminal-style metadata aesthetic.

## Layout & Spacing
The layout follows a **Fixed Grid** system for dashboards to ensure data visualization remains predictable. 

- **Desktop:** 12-column grid with a 1440px max container. Gutters are kept wide (24px) to allow the glass backgrounds of cards to breathe without overlapping visual noise.
- **Tablet:** 8-column grid with reduced margins (24px).
- **Mobile:** 4-column fluid grid.

Use a strict 8px spatial rhythm for vertical stacking. Components should utilize generous internal padding (16px to 24px) to reinforce the "premium" feel of the space.

## Elevation & Depth
Depth is created through **Glassmorphism** rather than traditional drop shadows.

- **Level 1 (Base):** Deep obsidian background (#09090b).
- **Level 2 (Cards/Panels):** Semi-transparent Zinc (#18181b) at 60% opacity with a `backdrop-filter: blur(12px)`.
- **Level 3 (Modals/Popovers):** Higher transparency with a `backdrop-filter: blur(24px)` and a subtle 1px inner border of Indigo at 20% opacity.

**Borders:** Use sleek, 1px solid borders for all containers. Border colors should be a slightly lighter Zinc (#27272a) to define edges against the dark background. No heavy outer shadows; instead, use a faint 4px outer glow of the primary color for "Active" or "Focused" states.

## Shapes
This design system uses **Soft** roundedness (4px - 12px) to maintain a balance between "Industrial/Secure" and "Modern SaaS."

- **Small Components (Buttons, Inputs):** 4px (0.25rem) radius for a precise, tool-like feel.
- **Containers (Cards, Sections):** 8px (0.5rem) radius.
- **Large Modals:** 12px (0.75rem) radius.

Avoid completely round "pill" shapes, as they contradict the technical, structured nature of a cybersecurity tool.

## Components

### Buttons
- **Primary:** Solid Indigo (#6366f1) with white text. High contrast. 
- **Secondary/Glass:** Transparent background with a 1px Zinc border and a subtle backdrop-blur. 
- **Active State:** Add a 2px outer glow (Indigo) to simulate a "powered on" state.

### Inputs
Terminal-style fields. Dark background, 1px border. On focus, the border turns Indigo and the label (in JetBrains Mono) shifts to a glowing state. Use a "block cursor" animation for text entry areas.

### Cards
Cards are the core of this system. They must feature a `backdrop-filter: blur(12px)` and a very subtle gradient border (top-left to bottom-right) from Zinc to a faint Indigo.

### Status Indicators
- **Secure:** Emerald Green dot with a 4px soft glow.
- **Breach/Alert:** High-contrast Red (#ef4444) with a pulsing animation.
- **Scanning:** A subtle indigo-tinted "shimmer" effect moving across the glass surface of the card.

### Technical Data Lists
Use `code-sm` (JetBrains Mono) for all list items. Zebra-striping should be done with 5% opacity Zinc overlays rather than solid colors to maintain the glass transparency.