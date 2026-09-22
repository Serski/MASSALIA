Politics, prompt 1: the Oligarchy chamber in the pottery look

What this builds

The council tab of the Politics panel takes the look of the pottery mockup (`Politics Screen.dc.html`), applied to our own screen: our four tabs, our chamber data and bench logic, the theme tokens, Cinzel and Spectral. The mockup is a mood board. Its hex values, its Cormorant, its fifth "Dynatoi" tab (that is the Your Party tab's tag) and its seat counts (one world on one day) are not copied. Where this prompt and the mockup differ, this prompt rules.

What changes:

* The tab row becomes flat blocks behind a ◆, the active tab a solid terracotta fill with dark ink, one terracotta rule under the row. Politics opts in with a `pottery` modifier on `.cs-tabs`; Standings and Family keep their tabs.
* The chamber card becomes a kiln-black card in a one-pixel terracotta frame with the auth card's Greek-key band along the top and bottom edges, and no background art. Inside: a header "Seats · 300 · N filled" followed by a dash-and-tick rule; the hemicycle in eight rows of square seats turned to face the centre, on a darker floor; a focus label under the arc; "◂ Left benches" and "Right benches ▸" under a rule; beside it, four party tiles and a line "Ringed seats · N held by living dynasties".
* Seat fills: Palaioi cream, Dynatoi terracotta, Independent a cream outline, Empty a dark square with a dim edge. A seat held by a living dynasty wears a terracotta ring; the viewer's own seat a heavier cream ring.
* The focus label shows the seat under the pointer or the last one tapped (its index and holder), else the viewer's own seat ("Your seat" / index / "House X · Party"), else the chamber's fill ("The Three Hundred" / filled count / "seats filled"). Leaving the arc with the mouse returns it to rest.
* The viewer's own party tile is solid terracotta with dark ink. An unaligned viewer has no highlighted tile.
* Every emoji on the council tab goes, and the Your Party tab reads "Your Party · Unaligned" where it showed 🔒.
* The party dots on the Offices rows and the office ledger (`.legend-dot`) take the chamber's colours and stay round.

What does not change:

* The bench assignment in `hemicycleLayout`: NPC Palaioi from the left, NPC Dynatoi from the right, NPC independents centred, bought and empty seats filling the free slots left to right by `seat_index`. Only the geometry changes (8 rows instead of 6, largest-remainder row counts). Known and left as is: bought seats therefore sit just right of the Palaioi bench whatever their party.
* A click on a held seat still opens the holder's public profile.
* The buy card, the vote cards, the League agenda and Offices keep their styling and copy, less their emoji.
* The Your Party, Cities and Diplomacy bodies are untouched, their emoji included.

Rulings carried by this prompt (Argiris, 22 Sept 2026):

* This supersedes the 20 Sept theme rule that the PALAIOI seat dots and the party colours keep their literals, for the chamber and the `.legend-dot` party dots only: Palaioi `--cream`, Dynatoi `--accent`, Independent a cream outline. Party banners and party art elsewhere do not change.
* Site fonts only (`--font-display`, `--font-body`). No Cormorant, no new font file.
* No new colour literal. Every colour is a theme or dashboard token. The one hex in the diff is `%23b8612f` (`--accent`) inside the section rule's SVG data URI, the same way the meander band carries `%2317110e`.
* `Politics.jpg` is no longer shown anywhere. The file stays where it is.
* Glyphs: ◆ (U+25C6), ◂ (U+25C2), ▸ (U+25B8). Not ◀ or ▶, which render as emoji on some systems. Every ✓ (U+2713) in the panel stays; it is a text glyph.

Contrast on the tokens used: `--accent-bright` 6.6:1 on `--card` and 6.95:1 on `--page`; `--dash-stone-dim` 4.79:1 on `--page` (used only on `--page` here); cream at 85% 10.2:1 on `--card`; `--on-accent` on `--accent` 4.50:1, the pair every accent button already uses.

Three commits, each its own concern:

1. `web: the Greek-key band as a shared class`. One selector in `styles.css`. The prompt copy rides in this commit.
2. `web: pottery tabs and no emoji on the council tab`. The Politics tab row, the emoji, the tab block in `dashboard.css`.
3. `web: the Oligarchy chamber in the pottery look`. The hemicycle, the focus label, the tiles, the chamber block in `dashboard.css`, and the render test.

The code below was built and run against 9f254d0 before this prompt was written (web `tsc`, lint, the web suite and `vite build` green; the new test file runs in under a second). Phase 0 still checks every anchor.

If `docs/politics/design/politics-screen.dc.html` is in the tree it is for the eye and rides in commit 1; the numbers in this prompt rule either way.

Commit 1: the shared band

`apps/web/src/styles.css`, in the auth block:

```css
/* Greek key band: one 24x12 tile drawn in the card colour on the accent. */
.auth-meander {
```

becomes

```css
/* Greek key band: one 24x12 tile drawn in the card colour on the accent.
   `.meander` is the same band for any other framed card (the chamber). */
.auth-meander,
.meander {
```

The body of the rule does not change. Nothing in the auth markup changes. The prompt is saved verbatim as `docs/politics/politics-prompt-1.md`.

Commit 2: the tab row and the emoji

All in `apps/web/src/dashboard/panels/PoliticsPanel.tsx`, matched by content. Each old string occurs exactly once in the file; STOP 0 if one does not.

* In `PoliticsPanel` (the default export): `<div className="cs-tabs" role="tablist">` becomes `<div className="cs-tabs pottery" role="tablist">`. The tab rows in `StandingsPanel.tsx` and `FamilyPanel.tsx` are not touched.
* In the same tab row: `<span className="party-tab-lock" aria-label="locked">🔒</span>` becomes `<span className="party-tab-lock">· Unaligned</span>`.
* In `OligarchySection`, the buy card kicker: `🏛️ A seat among the Three Hundred` becomes `A seat among the Three Hundred`.
* In `OligarchySection`, the no-seat row: `<PanelRow icon="🏛️" title="A seat among the Three Hundred"` becomes `<PanelRow icon={<img className="good-glyph" src={assetPath(OFFICE_ICON.oligarch ?? "")} alt="" loading="lazy" />} title="A seat among the Three Hundred"` (the Oligarchy seal the panel label already shows, at the 22px `.good-glyph` size inside the 36px `.pr-ic` box).
* In `OligarchySection`: `🗳️ The chamber votes — closes in` becomes `The chamber votes — closes in`.
* In `OligarchySection`: `"✅ The chamber assented" : "❌ The chamber refused"` becomes `"The chamber assented" : "The chamber refused"`.
* In `ElectionCycleCard`: `🗳️ {OFFICE_LABEL[office.office]} election` becomes `{OFFICE_LABEL[office.office]} election`.
* In `ElectionCycleCard`: `🔒 The ballot is secret.` becomes `The ballot is secret.`
* In `AgendaScopeSection`: `` "🏛️ The League agenda" : `⚖️ ${titleCase(view.scope)} agenda` `` becomes `` "The League agenda" : `${titleCase(view.scope)} agenda` ``. This component also renders the party agenda on the Your Party tab, which loses its ⚖️ with it; accepted.
* In `AgendaScopeSection`: `⛔ Veto {drafted.title}` becomes `Veto {drafted.title}`.

The `legend-yours` line (`🏛️ Your dynasty holds seat …`) goes with the chamber rewrite in commit 3. Stay as they are: `partyNews` (📣, ⚠️) and the censure ⚠️, all on the Your Party tab, and every ✓.

`apps/web/src/dashboard/dashboard.css`: directly after the line `.dashboard-shell .cs-tab{ white-space: nowrap; flex: none; }`, insert:

```css
/* Pottery tabs (politics prompt 1): flat blocks behind a diamond, one terracotta
   rule under the row, the active tab a solid terracotta fill. A panel opts in
   with `cs-tabs pottery`; the other tab rows keep the rules above. */
.dashboard-shell .cs-tabs.pottery{ gap: 4px; padding: 0; border-bottom: 1px solid var(--accent); }
.dashboard-shell .cs-tabs.pottery .cs-tab{ gap: 8px; padding: 10px 16px; color: rgba(var(--cream-rgb), 0.85); font-size: 11.5px; font-weight: 600; letter-spacing: 0.16em; background: transparent; border-bottom: 0; }
.dashboard-shell .cs-tabs.pottery .cs-tab::before{ content: "\25C6"; color: var(--accent-bright); font-size: 8px; letter-spacing: 0; }
.dashboard-shell .cs-tabs.pottery .cs-tab:hover{ color: var(--cream); background: rgba(var(--accent-rgb), 0.12); }
.dashboard-shell .cs-tabs.pottery .cs-tab.on{ color: var(--on-accent); background: var(--accent); }
.dashboard-shell .cs-tabs.pottery .cs-tab.on::before,
.dashboard-shell .cs-tabs.pottery .cs-tab.on .party-tab-tag{ color: inherit; }
```

The base `.cs-tabs` / `.cs-tab` rules above it do not change. The `.party-tab-tag` rule keeps its colour on inactive tabs; the last selector makes it dark ink on the active terracotta tab.

Commit 3: the chamber

`apps/web/src/dashboard/panels/PoliticsPanel.tsx`:

1. The react import `import { useCallback, useEffect, useMemo, useState } from "react";` becomes `import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";`.
2. Everything from `type SeatDot = {` up to, not including, the comment `// The public ballot record` (that is `SeatDot`, the old `hemicycleLayout` and the old `Hemicycle`) is replaced by the block below. `SEAT_PARTY_LABELS` above it stays. The bench section inside `hemicycleLayout` is the old one unchanged; the return now carries `angle`.

```tsx
type SeatDot = { x: number; y: number; angle: number; seat: ChamberSeat };

// Chamber geometry (politics prompt 1): eight rows of square seats, the inner
// row at 0.42 of the outer radius, seats per row proportional to the radius.
const HEMI_ROWS = 8;
const HEMI_INNER = 0.42;
const HEMI_CX = 230;
const HEMI_CY = 210;
const HEMI_R = 200;
const SEAT_HALF = 3.25;

const rowRadius = (i: number) => HEMI_INNER + (i * (1 - HEMI_INNER)) / (HEMI_ROWS - 1);

// Seats per row by largest remainder, so the rows always sum to the seat count
// (300 gives 22, 27, 31, 35, 40, 44, 48, 53).
export function hemicycleRows(total: number): number[] {
  const radii = Array.from({ length: HEMI_ROWS }, (_, i) => rowRadius(i));
  const weight = radii.reduce((sum, r) => sum + r, 0);
  const exact = radii.map((r) => (total * r) / weight);
  const counts = exact.map((x) => Math.floor(x));
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || b.i - a.i);
  let remainder = total - counts.reduce((sum, n) => sum + n, 0);
  for (let k = 0; remainder > 0; k++, remainder--) counts[order[k % HEMI_ROWS]!.i]!++;
  return counts;
}

// Lay the chamber out as a parliament arc. Display order groups the benches:
// Palaioi NPCs far left, Dynatoi NPCs far right, independents in the centre,
// and the bought/empty seats (seat_index 110+) filling the gaps left-to-right
// as players buy in. seat_index is the stable identity; this mapping is purely
// presentational.
export function hemicycleLayout(seats: ChamberSeat[]): SeatDot[] {
  const total = seats.length;
  if (!total) return [];
  const counts = hemicycleRows(total);

  // All seat positions, sorted left -> right across the arc.
  const positions: { x: number; y: number; angle: number }[] = [];
  counts.forEach((n, i) => {
    const r = HEMI_R * rowRadius(i);
    for (let k = 0; k < n; k++) {
      const angle = n === 1 ? Math.PI / 2 : Math.PI - (Math.PI * k) / (n - 1);
      positions.push({ x: HEMI_CX + r * Math.cos(angle), y: HEMI_CY - r * Math.sin(angle), angle });
    }
  });
  positions.sort((a, b) => b.angle - a.angle || a.y - b.y);

  // Benches: Palaioi left, Dynatoi right (mirrored), independents centred,
  // everything else (player + empty, by seat_index) fills the free slots.
  const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const slots = new Array<ChamberSeat | undefined>(total);
  const npc = (party: SeatParty) => ordered.filter((seat) => seat.holderType === "npc" && seat.party === party);
  npc("palaioi").forEach((seat, i) => (slots[i] = seat));
  npc("dynatoi").forEach((seat, i) => (slots[total - 1 - i] = seat));
  const independents = npc("independent");
  let cursor = Math.floor((total - independents.length) / 2);
  for (const seat of independents) {
    while (slots[cursor]) cursor++;
    slots[cursor] = seat;
  }
  cursor = 0;
  for (const seat of ordered) {
    if (seat.holderType === "npc") continue;
    while (slots[cursor]) cursor++;
    slots[cursor] = seat;
  }

  return slots.map((seat, i) => ({ ...positions[i]!, seat: seat! }));
}

const seatParty = (seat: ChamberSeat) => SEAT_PARTY_LABELS[seat.party ?? "independent"];

// The line under a seat's number in the focus label.
function seatNote(seat: ChamberSeat, seatPrice: number): string {
  if (seat.holderType === "player") return `${seat.holderName ?? "A citizen"} · ${seatParty(seat)}`;
  if (seat.holderType === "npc") return `${seatParty(seat)} bench`;
  return `Empty · ${seatPrice} dr.`;
}

function Hemicycle({
  seats,
  yourSeat,
  seatPrice,
  onSeatClick,
  onFocusSeat,
}: {
  seats: ChamberSeat[];
  yourSeat: number | null;
  seatPrice: number;
  onSeatClick: (seat: ChamberSeat) => void;
  onFocusSeat: (seat: ChamberSeat | null) => void;
}) {
  const dots = useMemo(() => hemicycleLayout(seats), [seats]);
  return (
    <svg className="hemicycle" viewBox="20 0 420 220" role="group" aria-label={`The Oligarchy chamber, ${seats.length} seats`} onMouseLeave={() => onFocusSeat(null)}>
      {dots.map(({ x, y, angle, seat }) => {
        // Every seat names itself in the focus label on hover or tap; only
        // player-held seats open the holder's public profile.
        const held = seat.holderType === "player";
        const clickable = held && seat.characterId !== null;
        const yours = yourSeat !== null && seat.seatIndex === yourSeat;
        const ring = yours ? 5.25 : 5;
        const interactive = clickable
          ? {
              role: "button",
              tabIndex: 0,
              "aria-label": `Seat ${seat.seatIndex}, ${seatNote(seat, seatPrice)}`,
              onFocus: () => onFocusSeat(seat),
              onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSeatClick(seat);
              },
            }
          : {};
        return (
          <g
            key={seat.seatIndex}
            data-seat={seat.seatIndex}
            className={`seat seat-${seat.party ?? "empty"}${clickable ? " seat-clickable" : ""}`}
            transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${((-angle * 180) / Math.PI).toFixed(2)})`}
            onMouseEnter={() => onFocusSeat(seat)}
            onClick={() => (clickable ? onSeatClick(seat) : onFocusSeat(seat))}
            {...interactive}
          >
            {held ? <rect className={`seat-ring${yours ? " seat-ring-you" : ""}`} x={-ring} y={-ring} width={ring * 2} height={ring * 2} /> : null}
            <rect className="seat-mark" x={-SEAT_HALF} y={-SEAT_HALF} width={SEAT_HALF * 2} height={SEAT_HALF * 2} />
          </g>
        );
      })}
    </svg>
  );
}
```

3. `OligarchySection`:
   * `function OligarchySection({ onRefresh }: PanelProps) {` becomes `function OligarchySection({ player, onRefresh }: PanelProps) {`. The call site already passes `player`.
   * Directly after the `profileTarget` state line, with the other hooks and above both early returns, add:

```tsx
  // The seat under the pointer (or last tapped); null shows the resting label.
  const [focusSeat, setFocusSeat] = useState<ChamberSeat | null>(null);
```

     This hook must sit above `if (error) return` and `if (!chamber) return`. A hook after an early return is React #310, the Atlas blackout of 10 Sept.
   * Directly after `const { composition, you } = chamber;`, add:

```tsx
  const filled = chamber.capacity - composition.empty;
  const yourSeat = you.holdsSeat ? chamber.seats.find((seat) => seat.seatIndex === you.seatIndex) ?? null : null;
  const yourParty = player.party === "Unaligned" ? null : player.party.toLowerCase();
  const citizens = (n: number) => `${n} ${n === 1 ? "citizen" : "citizens"}`;
  const tiles: { key: SeatParty | "empty"; label: string; count: number; sub: string }[] = [
    { key: "palaioi", label: "Palaioi", count: composition.npc.palaioi + composition.players.palaioi, sub: citizens(composition.players.palaioi) },
    { key: "dynatoi", label: "Dynatoi", count: composition.npc.dynatoi + composition.players.dynatoi, sub: citizens(composition.players.dynatoi) },
    { key: "independent", label: "Independent", count: composition.npc.independent + composition.players.independent, sub: citizens(composition.players.independent) },
    { key: "empty", label: "Empty", count: composition.empty, sub: `${chamber.seatPrice} dr. a seat` },
  ];
  // The label under the arc: the hovered or tapped seat, else your own seat,
  // else the chamber's fill.
  const shown = focusSeat ?? yourSeat;
  const focus =
    shown && yourSeat && shown.seatIndex === yourSeat.seatIndex
      ? { kicker: "Your seat", number: String(shown.seatIndex), sub: `House ${player.house.name} · ${seatParty(shown)}` }
      : shown
        ? { kicker: "Seat", number: String(shown.seatIndex), sub: seatNote(shown, chamber.seatPrice) }
        : { kicker: "The Three Hundred", number: String(filled), sub: "seats filled" };
```

   * The whole `<DashboardCard className="chamber-card">…</DashboardCard>` (the old `chamber-grid` with the `Hemicycle` and the `legend-row` list, `legend-yours` included) is replaced by:

```tsx
      <DashboardCard className="chamber-card">
        <div className="meander" aria-hidden="true" />
        <div className="chamber-body">
          <div className="chamber-head">
            <span className="chamber-head-label">Seats · {chamber.capacity} · {filled} filled</span>
            <span className="chamber-rule" aria-hidden="true" />
          </div>
          <div className="chamber-grid">
            <div className="chamber-floor">
              <Hemicycle seats={chamber.seats} yourSeat={yourSeat?.seatIndex ?? null} seatPrice={chamber.seatPrice} onSeatClick={openSeat} onFocusSeat={setFocusSeat} />
              <div className="chamber-focus">
                <span className="chamber-focus-kicker">{focus.kicker}</span>
                <span className="chamber-focus-number">{focus.number}</span>
                <span className="chamber-focus-sub">{focus.sub}</span>
              </div>
              <div className="chamber-benches" aria-hidden="true">
                <span>◂ Left benches</span>
                <span>Right benches ▸</span>
              </div>
            </div>
            <div className="chamber-legend">
              <div className="chamber-tiles">
                {tiles.map((tile) => (
                  <div key={tile.key} className={`chamber-tile seat-${tile.key}${tile.key === yourParty ? " is-yours" : ""}`}>
                    <span className="chamber-tile-swatch" aria-hidden="true" />
                    <span className="chamber-tile-count">
                      {tile.count}
                      <small>/{chamber.capacity}</small>
                    </span>
                    <span className="chamber-tile-name">{tile.label}</span>
                    <span className="chamber-tile-sub">{tile.sub}</span>
                  </div>
                ))}
              </div>
              <div className="chamber-ringed">
                <span className="chamber-ringed-mark" aria-hidden="true" />
                Ringed seats · {composition.playersTotal} held by living dynasties
              </div>
            </div>
          </div>
        </div>
        <div className="meander" aria-hidden="true" />
      </DashboardCard>
```

   `player.house.name` is the bare house name; `sheets.tsx` prints it as `House {player.house.name}` the same way.

`apps/web/src/dashboard/dashboard.css`:

1. Everything from the comment `/* The Oligarchy Chamber (Politics Prompt 1): hemicycle, seat purchase, ledger. */` up to, not including, `.dashboard-shell .oligarchy-buy-card {` is replaced by the block below. That removes the `Politics.jpg` background, every `.seat-dot` rule, `.chamber-legend`, `.legend-row`, `.legend-note` and `.legend-yours`, and restates `.legend-dot` with the new party colours (the Offices rows and the office ledger use it through `partyDotClass`).

```css
/* The Oligarchy Chamber (politics prompt 1, Sept 2026): a kiln-black card in a
   one-pixel terracotta frame with the Greek-key band top and bottom, eight rows
   of square seats, a focus label under the arc and a party tile per bench. */
.dashboard-shell .chamber-card { margin-bottom: 14px; padding: 0; gap: 0; background: var(--card); border: 1px solid var(--accent); box-shadow: none; transition: none; }
.dashboard-shell .chamber-card:hover { border-color: var(--accent); box-shadow: none; transform: none; }
.dashboard-shell .chamber-card::before { display: none; }
.dashboard-shell .chamber-body { display: grid; gap: 14px; padding: 16px 18px 18px; }
.dashboard-shell .chamber-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dashboard-shell .chamber-head-label { flex: none; color: var(--accent-bright); font-family: var(--font-display); font-size: 11px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; }
/* Two terracotta hairlines with a dash-and-tick run between them. */
.dashboard-shell .chamber-rule { flex: 1; min-width: 24px; height: 9px; box-sizing: border-box; border-top: 1px solid var(--accent); border-bottom: 1px solid var(--accent); background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='7' viewBox='0 0 16 7'%3E%3Cpath d='M0 3.5H8M12 1.5V5.5' fill='none' stroke='%23b8612f' stroke-width='1'/%3E%3C/svg%3E") left center / 16px 7px repeat-x; }
.dashboard-shell .chamber-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(220px, 1fr); gap: 16px; align-items: start; }
.dashboard-shell .chamber-floor { display: grid; gap: 8px; min-width: 0; padding: 12px 12px 10px; background: var(--page); border: 1px solid rgba(var(--accent-rgb), 0.45); }
.dashboard-shell .hemicycle { width: 100%; height: auto; display: block; }
.dashboard-shell .seat-palaioi .seat-mark { fill: var(--cream); }
.dashboard-shell .seat-dynatoi .seat-mark { fill: var(--accent); }
.dashboard-shell .seat-independent .seat-mark { fill: var(--page); stroke: var(--cream); stroke-width: 1.2; }
.dashboard-shell .seat-empty .seat-mark { fill: var(--dash-panel-soft); stroke: var(--line); stroke-width: 1; }
/* A seat held by a living dynasty wears a terracotta ring; the viewer's own a heavier cream one. */
.dashboard-shell .seat-ring { fill: none; stroke: var(--accent); stroke-width: 1.5; }
.dashboard-shell .seat-ring.seat-ring-you { stroke: var(--cream); stroke-width: 2; }
/* Only player-held seats open a profile; every seat names itself in the focus label. */
.dashboard-shell .seat-clickable { cursor: pointer; }
.dashboard-shell .seat-clickable:focus { outline: none; }
.dashboard-shell .seat-clickable:focus-visible .seat-mark { stroke: var(--accent-bright); stroke-width: 1.5; }
.dashboard-shell .chamber-focus { display: grid; justify-items: center; gap: 2px; text-align: center; }
.dashboard-shell .chamber-focus-kicker { color: var(--dash-stone-dim); font-family: var(--font-display); font-size: 10px; font-weight: 600; letter-spacing: 0.24em; text-transform: uppercase; }
.dashboard-shell .chamber-focus-number { color: var(--cream); font-family: var(--font-display); font-size: 26px; font-weight: 700; line-height: 1.1; }
.dashboard-shell .chamber-focus-sub { color: var(--accent-bright); font-family: var(--font-body); font-size: 13px; font-style: italic; }
.dashboard-shell .chamber-benches { display: flex; justify-content: space-between; gap: 12px; padding-top: 7px; border-top: 1px solid rgba(var(--accent-rgb), 0.45); color: var(--dash-stone-dim); font-family: var(--font-display); font-size: 10px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; }
.dashboard-shell .chamber-legend { display: grid; gap: 10px; min-width: 0; }
.dashboard-shell .chamber-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.dashboard-shell .chamber-tile { display: grid; grid-template-columns: auto 1fr; align-items: center; column-gap: 8px; row-gap: 3px; padding: 10px 12px; background: var(--page); border: 1px solid rgba(var(--accent-rgb), 0.45); }
.dashboard-shell .chamber-tile-swatch { width: 10px; height: 10px; box-sizing: border-box; border: 1px solid transparent; }
.dashboard-shell .chamber-tile-count { color: var(--cream); font-family: var(--font-display); font-size: 22px; font-weight: 700; line-height: 1; }
.dashboard-shell .chamber-tile-count small { margin-left: 2px; color: var(--dash-stone-dim); font-size: 11px; font-weight: 600; }
.dashboard-shell .chamber-tile-name { grid-column: 1 / -1; color: var(--cream); font-family: var(--font-display); font-size: 10.5px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; }
.dashboard-shell .chamber-tile-sub { grid-column: 1 / -1; color: var(--accent-bright); font-family: var(--font-body); font-size: 12.5px; font-style: italic; }
.dashboard-shell .chamber-tile.seat-palaioi .chamber-tile-swatch { background: var(--cream); }
.dashboard-shell .chamber-tile.seat-dynatoi .chamber-tile-swatch { background: var(--accent); }
.dashboard-shell .chamber-tile.seat-independent .chamber-tile-swatch { border: 1.5px solid var(--cream); }
.dashboard-shell .chamber-tile.seat-empty .chamber-tile-swatch { background: var(--dash-panel-soft); border-color: var(--line); }
/* The viewer's own party: a solid terracotta tile, every line of it in the dark ink. */
.dashboard-shell .chamber-tile.is-yours { background: var(--accent); border-color: var(--accent); }
.dashboard-shell .chamber-tile.is-yours .chamber-tile-count,
.dashboard-shell .chamber-tile.is-yours .chamber-tile-count small,
.dashboard-shell .chamber-tile.is-yours .chamber-tile-name,
.dashboard-shell .chamber-tile.is-yours .chamber-tile-sub { color: var(--on-accent); }
.dashboard-shell .chamber-tile.is-yours .chamber-tile-swatch { border-color: var(--on-accent); }
.dashboard-shell .chamber-ringed { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; }
.dashboard-shell .chamber-ringed-mark { flex: none; width: 10px; height: 10px; box-sizing: border-box; border: 1.5px solid var(--accent); }
/* Party dots on the Offices rows and the office ledger, in the chamber's colours. */
.dashboard-shell .legend-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
.dashboard-shell .legend-dot.seat-palaioi { background: var(--cream); }
.dashboard-shell .legend-dot.seat-dynatoi { background: var(--accent); }
.dashboard-shell .legend-dot.seat-independent { background: transparent; box-shadow: inset 0 0 0 1.5px var(--cream); }
.dashboard-shell .legend-dot.seat-empty { background: var(--dash-panel-soft); box-shadow: inset 0 0 0 1px var(--line); }
```

2. The media block

```css
@media (max-width: 760px) {
  .dashboard-shell .chamber-grid { grid-template-columns: 1fr; }
}
```

becomes

```css
@media (max-width: 760px) {
  .dashboard-shell .chamber-grid { grid-template-columns: 1fr; }
  .dashboard-shell .chamber-body { padding: 14px 12px 16px; }
  .dashboard-shell .chamber-floor { padding: 10px 8px 8px; }
}
```

The render test, `apps/web/test/politics-chamber.test.tsx`, follows `barracks-panel.test.tsx` (jsdom pragma, `cleanup` and `restoreAllMocks` after each, plain DOM selectors). It mounts `PoliticsPanel` with the chamber and the chamber votes mocked, and the agenda, offices and elections calls left pending forever so those sections stay on their loading text. If Phase 0 finds the council tab calling anything else on mount, add it to `mount` the same way and name it in the report.

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ChamberSeat, type ChamberView } from "../src/api.js";
import PoliticsPanel, { hemicycleLayout, hemicycleRows } from "../src/dashboard/panels/PoliticsPanel.js";

// ---------------------------------------------------------------------------
// The Oligarchy chamber (politics prompt 1): the row split, the bench layout,
// and the council tab mounted against a mocked chamber: tabs, header, seat
// fills and rings, the focus label on hover, tap and leave, the party tiles.
// The agenda and offices calls never settle, so those sections stay loading.
// ---------------------------------------------------------------------------

const YOU = 112;
const PLAYERS: { index: number; party: "palaioi" | "dynatoi" | "independent" }[] = [
  { index: 110, party: "palaioi" },
  { index: 111, party: "dynatoi" },
  { index: YOU, party: "dynatoi" },
  { index: 113, party: "independent" },
  { index: 114, party: "palaioi" },
  { index: 115, party: "dynatoi" },
  { index: 116, party: "palaioi" },
  { index: 117, party: "dynatoi" },
];

function seats(): ChamberSeat[] {
  const out: ChamberSeat[] = [];
  for (let i = 0; i < 300; i++) {
    const npcParty = i < 50 ? "palaioi" : i < 100 ? "dynatoi" : i < 110 ? "independent" : null;
    const player = PLAYERS.find((p) => p.index === i);
    if (npcParty) out.push({ seatIndex: i, holderType: "npc", party: npcParty, holderName: null, characterId: null });
    else if (player) out.push({ seatIndex: i, holderType: "player", party: player.party, holderName: `Citizen ${i}`, characterId: `char-${i}` });
    else out.push({ seatIndex: i, holderType: "empty", party: null, holderName: null, characterId: null });
  }
  return out;
}

function chamber(holdsSeat: boolean): ChamberView {
  return {
    capacity: 300,
    seatPrice: 200,
    seats: seats(),
    composition: { npc: { palaioi: 50, dynatoi: 50, independent: 10 }, players: { palaioi: 3, dynatoi: 4, independent: 1 }, playersTotal: 8, empty: 182 },
    you: holdsSeat ? { holdsSeat: true, seatIndex: YOU, canBuy: false, reason: null } : { holdsSeat: false, seatIndex: null, canBuy: true, reason: null },
  };
}

const player = (party: "Dynatoi" | "Unaligned") =>
  ({ party, professionSlug: "trader", censured: false, censureExpiresAt: null, house: { name: "Herakleides" } }) as unknown as Parameters<typeof PoliticsPanel>[0]["player"];

const never = () => new Promise<never>(() => {});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const EMOJI = /\p{Extended_Pictographic}/u;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount(view: ChamberView, party: "Dynatoi" | "Unaligned") {
  vi.spyOn(api, "oligarchyChamber").mockResolvedValue(view);
  vi.spyOn(api, "chamberVotes").mockResolvedValue({ open: null, past: [] } as unknown as Awaited<ReturnType<typeof api.chamberVotes>>);
  vi.spyOn(api, "agenda").mockImplementation(never);
  vi.spyOn(api, "offices").mockImplementation(never);
  vi.spyOn(api, "elections").mockImplementation(never);
  const utils = render(<PoliticsPanel player={player(party)} onRefresh={() => {}} />);
  await flush();
  return utils;
}

const text = (c: HTMLElement, sel: string) => c.querySelector(sel)?.textContent ?? "";
const focusLabel = (c: HTMLElement) => [".chamber-focus-kicker", ".chamber-focus-number", ".chamber-focus-sub"].map((s) => text(c, s));

describe("chamber layout", () => {
  it("splits 300 seats 22/27/31/35/40/44/48/53 and any count exactly", () => {
    expect(hemicycleRows(300)).toEqual([22, 27, 31, 35, 40, 44, 48, 53]);
    for (const n of [1, 7, 120, 301]) expect(hemicycleRows(n).reduce((a, b) => a + b, 0)).toBe(n);
  });

  it("places every seat once, NPC Palaioi leftmost and NPC Dynatoi rightmost", () => {
    const dots = hemicycleLayout(seats());
    expect(new Set(dots.map((d) => d.seat.seatIndex)).size).toBe(300);
    expect(dots.slice(0, 50).every((d) => d.seat.holderType === "npc" && d.seat.party === "palaioi")).toBe(true);
    expect(dots.slice(-50).every((d) => d.seat.holderType === "npc" && d.seat.party === "dynatoi")).toBe(true);
  });
});

describe("council tab", () => {
  it("renders the pottery tabs, the chamber and the tiles for a seated Dynatoi", async () => {
    const { container } = await mount(chamber(true), "Dynatoi");

    expect(container.querySelector(".cs-tabs.pottery")).not.toBeNull();
    expect(container.querySelectorAll(".cs-tab").length).toBe(4);
    expect(text(container, ".chamber-head-label")).toBe("Seats · 300 · 118 filled");
    expect(container.querySelectorAll(".meander").length).toBe(2);

    expect(container.querySelectorAll(".hemicycle .seat").length).toBe(300);
    expect(container.querySelectorAll(".seat-ring").length).toBe(8);
    expect(container.querySelectorAll(".seat-ring-you").length).toBe(1);
    const mine = container.querySelector(`[data-seat="${YOU}"]`)!;
    expect(mine.classList.contains("seat-dynatoi")).toBe(true);
    expect(mine.querySelector(".seat-ring-you")).not.toBeNull();

    expect(focusLabel(container)).toEqual(["Your seat", "112", "House Herakleides · Dynatoi"]);

    const tiles = container.querySelectorAll(".chamber-tile");
    expect(tiles.length).toBe(4);
    expect([...tiles].map((t) => t.querySelector(".chamber-tile-count")!.textContent)).toEqual(["53/300", "54/300", "11/300", "182/300"]);
    expect(text(container, ".chamber-tile.is-yours .chamber-tile-name")).toBe("Dynatoi");
    expect(text(container, ".chamber-ringed")).toContain("8 held by living dynasties");

    expect(EMOJI.test(text(container, ".cs-tabs"))).toBe(false);
    expect(EMOJI.test(text(container, ".pol-page"))).toBe(false);
  });

  it("hover, tap and leave move the focus label", async () => {
    const { container } = await mount(chamber(true), "Dynatoi");
    const svg = container.querySelector(".hemicycle")!;

    fireEvent.mouseEnter(container.querySelector('[data-seat="200"]')!);
    expect(focusLabel(container)).toEqual(["Seat", "200", "Empty · 200 dr."]);
    fireEvent.mouseLeave(svg);
    expect(text(container, ".chamber-focus-number")).toBe("112");

    fireEvent.click(container.querySelector('[data-seat="3"]')!);
    expect(focusLabel(container)).toEqual(["Seat", "3", "Palaioi bench"]);

    fireEvent.mouseEnter(container.querySelector('[data-seat="115"]')!);
    expect(focusLabel(container)).toEqual(["Seat", "115", "Citizen 115 · Dynatoi"]);
  });

  it("with no seat and no party the label shows the chamber's fill and no tile is yours", async () => {
    const { container } = await mount(chamber(false), "Unaligned");
    expect(focusLabel(container)).toEqual(["The Three Hundred", "118", "seats filled"]);
    expect(container.querySelector(".seat-ring-you")).toBeNull();
    expect(container.querySelector(".chamber-tile.is-yours")).toBeNull();
    expect(text(container, ".party-tab-lock")).toBe("· Unaligned");
  });
});
```

Phase 0: recon (no code)

Confirm, and STOP 0 with the mismatch if any is not as described:

* HEAD is 9f254d0 or a descendant, and nothing since touched `PoliticsPanel.tsx`, `dashboard.css` or the auth block of `styles.css`.
* `PoliticsPanel.tsx`: `type SeatDot = { x: number; y: number; seat: ChamberSeat }`; `hemicycleLayout` with `rowCount = 6` and radii `86 + i * 22`, not exported; `Hemicycle` drawing `<circle className="seat-dot …">` with a `<title>` per seat; the comment `// The public ballot record` right after it; `function OligarchySection({ onRefresh }: PanelProps)` called as `<OligarchySection player={player} onRefresh={onRefresh} />`; every old string listed under commit 2 present exactly once; the default export's tab row is the only `cs-tabs` in the file.
* The council tab calls, on mount, `api.oligarchyChamber`, `api.chamberVotes`, `api.agenda`, `api.offices` and `api.elections`, and nothing else.
* `dashboard.css`: the chamber block runs from the `/* The Oligarchy Chamber (Politics Prompt 1)` comment to `.dashboard-shell .oligarchy-buy-card {`; the `@media (max-width: 760px)` block holds only `.chamber-grid`; the line `.dashboard-shell .cs-tab{ white-space: nowrap; flex: none; }` exists once; `--dash-panel-soft` and `--dash-stone-dim` are defined in the `.dashboard-shell` block.
* `styles.css`: the rule `.auth-meander {` with the "Greek key band" comment above it, its background ending in `round`.
* `git grep -n "seat-dot\|legend-row\|legend-note\|chamber-legend\|seat-held" apps/web/src` finds nothing outside `PoliticsPanel.tsx` and the chamber block of `dashboard.css`; `legend-dot` appears in `PoliticsPanel.tsx` only in `OfficeSeatRow` and the office ledger besides the chamber.
* `git grep -n "Politics.jpg" apps/web/src` finds only the `.chamber-card` rule.
* No file under `apps/web/test` references `PoliticsPanel`, `hemicycle` or `cs-tabs`.

Phases 1 to 3

One commit each, in the order above. After each: `pnpm --filter @massalia/web lint`, `pnpm --filter @massalia/web exec tsc --noEmit`, and the web suite green.

Phase 4: gate, browser check, scans, then STOP 1

1. Full gate at HEAD: `DATABASE_URL=…/massalia_test pnpm gate`, ending `GATE GREEN`. A red from a timeout in a suite the diff does not touch is a STOP item with the log, not a rerun.
2. Browser check on the dev server against the local API, with a character that holds a seat (buy one through the panel if none does) and one that holds none. Captures at 1440px, 920px and 390px into the theme-shots folder, prefixed `politics-`:
   * the council tab at rest, seated;
   * the same with the pointer on an empty seat;
   * the council tab unseated (the Three Hundred label and the buy card);
   * the Your Party tab active, so the tag sits on the terracotta tab;
   * the Offices section, for the party dots;
   * the Standings tab row, to show it unchanged.

   Note, as ruling items and not fixes: whether the four tabs sit on one line at 920px; whether the "House … · Party" line fits under the arc at 390px; whether both meander bands end on a whole key at all three widths; how the seats and rings read at 390px; whether the Your Party, Cities and Diplomacy bodies look out of place under the new tab row.
3. Computed-style scan of every element inside `.chamber-card` and `.cs-tabs.pottery`, as the theme prompt did it: every element whose text colour is `#b8612f`, every `background-image` that is a gradient, every non-zero `border-radius`. All three lists must be empty. Then, with the agenda and offices loaded on a seated character, the council tab's rendered text scanned for `\p{Extended_Pictographic}`: zero hits.

Then STOP 1 with the report. Push only when Argiris says so.

Scope fence

* Only `apps/web/src/dashboard/panels/PoliticsPanel.tsx`, `apps/web/src/dashboard/dashboard.css`, the one selector in `apps/web/src/styles.css`, `apps/web/test/politics-chamber.test.tsx`, the prompt copy and the mockup file. No server, no `api.ts`, no content, no migration.
* No change to the bench section of `hemicycleLayout`, to the base `.cs-tabs` / `.cs-tab` rules, to `StandingsPanel.tsx` or `FamilyPanel.tsx`, or to the auth markup.
* No copy change beyond the emoji removals and the chamber strings written above.
* The Your Party, Cities and Diplomacy bodies are untouched.
* `Politics.jpg` is not deleted.
* Push only as the last paragraph says.

Push

After the STOP 1 ruling: fast-forward only, plain `git push`, the three commits. Report remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (nothing server-side changes; no migration). Close-out: dev servers and the throwaway Postgres stopped, tree clean at remote HEAD.

Report template

```
Committed: <SHA> web: the Greek-key band as a shared class
Committed: <SHA> web: pottery tabs and no emoji on the council tab
Committed: <SHA> web: the Oligarchy chamber in the pottery look
Gate: GATE GREEN at <SHA>, <wall time>, suite counts <shared/server/db/web/worker>
Captures: <path per surface, or the STOP>
Scan: accent text <n>, gradients <n>, radii <n>, emoji <n> (each must be 0)
Deviations: <none, or one line each>
Ruling items: <none, or one line each>
```

STOP 1 ruling (Argiris, 22 Sept 2026).

All seven ruling items accepted as reported, no code change:
1, 3, 4: pass.
2: the tab row scrolling sideways at 390px stays, same as every other tab row.
5: seat density at 390px stays.
6: the bought-seat placement stays for this push (a separate prompt follows); the outlined swatch on the viewer's own tile stays.
7: Cities and Diplomacy get a live look after deploy, no captures needed.
The gradient the scan found on the hidden dashboard-card top line is accepted, since the chamber sets it to display: none.
The drachmae and seat written to the throwaway database need no action.

No new commit. This ruling is appended to docs/politics/politics-prompt-1.md in the first commit of the next politics prompt, not now.

Push: fast-forward only, plain git push, the three commits a9cce4a, 6c27b0a, 6e958ca.
Report:
- remote HEAD
- the CI run and its Gate step
- the Pages run
- the Railway server and worker deploys (nothing server-side changed, no migration)

Close-out:
- stop the dev servers and the throwaway Postgres on 5433
- tree clean at remote HEAD
- a short handoff
