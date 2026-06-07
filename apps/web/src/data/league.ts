import {
  nobleHouses as sharedNobleHouses,
  professions as sharedProfessions,
  type House,
  type Profession,
} from "@massalia/shared";

export { buildableBuildings } from "@massalia/shared";

export type {
  Alignment,
  BuildableBuilding,
  House,
  NarrativeMilestone,
  Profession,
  Tier,
} from "@massalia/shared";

export function assetPath(path: string) {
  return `${import.meta.env.BASE_URL}${path}`.replace(/([^:])\/+/g, "$1/");
}

export const professions: Profession[] = sharedProfessions.map((profession) => ({
  ...profession,
  image: assetPath(profession.image),
}));

export const nobleHouses: House[] = sharedNobleHouses.map((house) => ({
  ...house,
  image: assetPath(house.image),
}));
