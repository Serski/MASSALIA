import { assetPath } from "./league.js";

export type PortraitOption = {
  id: string;
  label: string;
  image: string;
};

const portraitSlots = ["01", "02", "03", "04", "05", "06"] as const;

const portraitClassSlugs = [
  "landowner",
  "trader",
  "priest",
  "philosopher",
  "shipbuilder",
  "hetaira",
  "military-leader",
  "slave",
] as const;

export type PortraitClassSlug = (typeof portraitClassSlugs)[number];

export const portraitPools: Record<PortraitClassSlug, PortraitOption[]> = Object.fromEntries(
  portraitClassSlugs.map((classSlug) => [
    classSlug,
    portraitSlots.map((slot) => ({
      id: `${classSlug}-${slot}`,
      label: `${classSlug.replace("-", " ")} ${slot}`,
      image: assetPath(`assets/portraits/${classSlug}/${slot}.png`),
    })),
  ]),
) as Record<PortraitClassSlug, PortraitOption[]>;
