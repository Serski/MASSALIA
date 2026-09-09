import { assetPath } from "../data/league.js";

// Every image choice the lobby makes, in one place, so the art can be retuned
// without touching a component. All files ship under apps/web/public already.

// The active-world hero: the class building render by profession (tier 3).
export const HERO_BY_PROFESSION: Record<string, string> = {
  trader: assetPath("assets/buildings/emporion-3.webp"),
  landowner: assetPath("assets/buildings/estate-3.webp"),
  priest: assetPath("assets/buildings/sanctuary-3.webp"),
  philosopher: assetPath("assets/buildings/school-3.webp"),
  hetaira: assetPath("assets/buildings/salon-3.webp"),
  shipbuilder: assetPath("assets/buildings/slipway-3.webp"),
};

// Hoplite, slave, an unknown slug, and no seat at all.
export const HERO_FALLBACK = assetPath("assets/Court.webp");

export function heroFor(professionSlug: string | null): string {
  return (professionSlug && HERO_BY_PROFESSION[professionSlug]) || HERO_FALLBACK;
}

// The calendar cards.
export const CALENDAR_ANNOUNCED = assetPath("assets/buildings/slipway-1.webp");
export const CALENDAR_ENDED = assetPath("assets/Court.webp");

// The Guides box thumbnail.
export const GUIDES_THUMB = assetPath("assets/Ledger.webp");

// The character card without a seat.
export const NO_SEAT_PORTRAIT = assetPath("assets/MASSALIA LION.png");
