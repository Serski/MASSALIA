import { useEffect, useState } from "react";
import { professions } from "../data/league.js";
import { getFaceImage } from "../dashboard/shared.js";

// The portrait the dashboard shows, resolved the same way AvatarImage does
// (dashboard/sheets.tsx): the aged avatar portrait, then the class portrait
// chosen at creation, then the profession art, then the name's first letter.
// Each candidate falls through to the next on a load error.
export function LobbyPortrait({
  portrait,
  faceId,
  professionSlug,
  name,
  size,
  className = "",
}: {
  portrait: string | null;
  faceId: string | null;
  professionSlug: string | null;
  name: string;
  size: number;
  className?: string;
}) {
  const face = professionSlug ? getFaceImage(professionSlug, faceId) : undefined;
  const art = professionSlug ? professions.find((item) => item.slug === professionSlug)?.image : undefined;
  const candidates = [portrait, face, art].filter(Boolean) as string[];
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [portrait, face, art]);
  const src = candidates[idx];
  const style = { width: size, height: size };
  if (!src) {
    return (
      <span className={`lobby-portrait lobby-portrait-letter ${className}`} style={{ ...style, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
        {name.charAt(0)}
      </span>
    );
  }
  return <img className={`lobby-portrait ${className}`} style={style} src={src} alt="" loading="lazy" onError={() => setIdx((current) => current + 1)} />;
}
