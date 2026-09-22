Politics, prompt 2: bought seats sit with their own bench
What this builds
In the Oligarchy chamber every bought seat is drawn just right of the Palaioi bench, whatever its party, because `hemicycleLayout` fills the free slots left to right by `seat_index` once the NPC benches are placed. A Dynatoi player's terracotta seat therefore sits among the cream Palaioi seats. From this prompt on, a bought seat joins its own party's bench:

* Palaioi: the NPC Palaioi seats from the left edge, then the Palaioi player seats by `seat_index`, growing inward.
* Dynatoi: the NPC Dynatoi seats from the right edge, then the Dynatoi player seats by `seat_index`, growing inward.
* Independents: the NPC independents, then the independent player seats (a player seat with no party counts as independent), as one block centred on the arc.
* Empty seats take the slots left over, left to right.

`seat_index` stays the identity and the mapping stays presentational. Nothing else changes: not the geometry (eight rows, 22/27/31/35/40/44/48/53 at 300 seats), not the rings, the focus label, the tiles, the click-to-profile, the stylesheet or any server code. On today's chamber (50/50/10 NPC seats) the result reads, left to right: Palaioi bench, empty, independents, empty, Dynatoi bench.
If a bench runs into another block (only possible in a nearly full chamber), a seat takes the next free slot in its direction, and failing that the nearest free slot back the other way. Slots and seats are equal in number, so every seat is always placed exactly once; a test covers a chamber one party has bought out.
One commit: `web: bought seats sit with their own bench`. It carries:

1. the layout change in `apps/web/src/dashboard/panels/PoliticsPanel.tsx`,
2. two new layout tests in `apps/web/test/politics-chamber.test.tsx`,
3. the prompt 1 STOP 1 ruling appended verbatim to the end of `docs/politics/politics-prompt-1.md` (as that ruling said),
4. this prompt saved verbatim as `docs/politics/politics-prompt-2.md`.

The code below was built and run against 6e958ca before this prompt was written: web `tsc` and lint clean, the web suite green (24 files, 81 tests), and both new tests red on 6e958ca's layout and green after the change.
The change
In `PoliticsPanel.tsx`, the comment directly above `export function hemicycleLayout(` becomes:

```tsx
// Lay the chamber out as a parliament arc. Display order groups the benches:
// Palaioi far left, Dynatoi far right, independents in the centre, a bought
// seat joining its own party's bench, and the empty seats between. seat_index
// is the stable identity; this mapping is purely presentational.

```

Inside `hemicycleLayout`, everything from the comment `// Benches: Palaioi left, Dynatoi right (mirrored), independents centred,` up to, not including, `return slots.map((seat, i) => ({ ...positions[i]!, seat: seat! }));` is replaced by:

```tsx
  // Benches: Palaioi from the left edge, Dynatoi from the right (mirrored),
  // independents from the centre. Each bench is its NPC seats, then its player
  // seats by seat_index, so a bought seat sits with its own party and the bench
  // grows inward as players buy in. Empty seats take what is left, left to right.
  const ordered = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const slots = new Array<ChamberSeat | undefined>(total);
  const bench = (party: SeatParty) => [
    ...ordered.filter((seat) => seat.holderType === "npc" && seat.party === party),
    ...ordered.filter((seat) => seat.holderType === "player" && (seat.party ?? "independent") === party),
  ];
  // The first free slot from `start` going `step`; if that runs off the arc,
  // the nearest free slot back the other way. Slots and seats are equal in
  // number, so there always is one.
  const place = (seat: ChamberSeat, start: number, step: 1 | -1): number => {
    for (const dir of [step, -step]) {
      for (let i = dir === step ? start : start - step; i >= 0 && i < total; i += dir) {
        if (!slots[i]) {
          slots[i] = seat;
          return i;
        }
      }
    }
    return -1;
  };
  let left = 0;
  for (const seat of bench("palaioi")) left = place(seat, left, 1) + 1;
  let right = total - 1;
  for (const seat of bench("dynatoi")) right = place(seat, right, -1) - 1;
  const centre = bench("independent");
  let mid = Math.floor((total - centre.length) / 2);
  for (const seat of centre) mid = place(seat, mid, 1) + 1;
  const placed = new Set(slots);
  let rest = 0;
  for (const seat of ordered) if (!placed.has(seat)) rest = place(seat, rest, 1) + 1;

```

The positions code above it and the return line stay exactly as they are. `hemicycleRows`, `Hemicycle` and `OligarchySection` are not touched.
The tests
In `apps/web/test/politics-chamber.test.tsx`, insert this block directly before `describe("council tab", () => {`. It uses the file's own `seats()` fixture (NPC seats 0 to 109 as 50 Palaioi, 50 Dynatoi, 10 independents; player seats 110, 114, 116 Palaioi, 111, 112, 115, 117 Dynatoi, 113 independent; the rest empty), so nothing else in the file changes.

```tsx
describe("chamber benches", () => {
  it("seats each player with their own party's bench and leaves the empties between", () => {
    const dots = hemicycleLayout(seats());
    const idx = (from: number, to: number) => dots.slice(from, to).map((d) => d.seat.seatIndex);
    expect(idx(50, 53)).toEqual([110, 114, 116]);
    expect(idx(246, 250)).toEqual([117, 115, 112, 111]);
    expect(idx(144, 155)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 113]);
    expect(dots.slice(53, 144).every((d) => d.seat.holderType === "empty")).toBe(true);
    expect(dots.slice(155, 246).every((d) => d.seat.holderType === "empty")).toBe(true);
  });

  it("still places every seat once when one party buys the whole chamber", () => {
    const full = seats().map((s): ChamberSeat => (s.holderType === "empty" ? { ...s, holderType: "player", party: "palaioi", holderName: "P", characterId: `p-${s.seatIndex}` } : s));
    const dots = hemicycleLayout(full);
    expect(dots.every((d) => d.seat !== undefined)).toBe(true);
    expect(new Set(dots.map((d) => d.seat.seatIndex)).size).toBe(300);
    expect(dots.slice(235, 246).every((d) => d.seat.party === "independent")).toBe(true);
  });
});

```

Before editing `PoliticsPanel.tsx`, add the tests and run the file once: both new tests must fail on 6e958ca's layout. Report that run.
The ruling to append
At the end of `docs/politics/politics-prompt-1.md`, after one blank line, append exactly:

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

```

Phase 0: recon (no code)
Confirm, and STOP 0 with the mismatch if any is not as described:

* HEAD is 6e958ca or a descendant, and nothing since touched `PoliticsPanel.tsx`, `politics-chamber.test.tsx` or `docs/politics/politics-prompt-1.md`.
* `PoliticsPanel.tsx`: the comment above `export function hemicycleLayout(` begins `// Lay the chamber out as a parliament arc. Display order groups the benches:`; inside it, the block from `// Benches: Palaioi left, Dynatoi right (mirrored), independents centred,` to the return fills NPC Palaioi from slot 0, NPC Dynatoi from the last slot, NPC independents from `Math.floor((total - independents.length) / 2)`, then every non-NPC seat left to right.
* `politics-chamber.test.tsx` has a `seats()` fixture as described above and a `describe("council tab", () => {` block.
* `docs/politics/politics-prompt-1.md` ends with the report template of prompt 1 and carries no STOP 1 ruling yet.

Phase 1: the commit
The tests first (red, as above), then the source change, the ruling append and the prompt copy, in one commit. After it: `pnpm --filter @massalia/web lint`, `pnpm --filter @massalia/web exec tsc --noEmit`, and the web suite green.
Phase 2: gate, browser check, then STOP 1

1. Full gate at HEAD: `DATABASE_URL=…/massalia_test pnpm gate`, ending `GATE GREEN`. A red from a timeout in a suite the diff does not touch is a STOP item with the log, not a rerun.
2. Browser check on the dev server against the local API, with at least one Palaioi and one Dynatoi player seat in the throwaway database (set them up however is quickest there; nothing touches production). Captures at 1440px and 390px into the theme-shots folder, prefixed `politics2-`: the council tab at rest on a seated character, and the same with the pointer on a Palaioi player seat. Note, as ruling items and not fixes: whether each player seat sits at the inner edge of its own party's bench, and whether the viewer's cream ring is on the correct side.

Then STOP 1 with the report. Push only when Argiris says so.
Scope fence

* Only the comment and the bench block of `hemicycleLayout`, the new tests, the ruling append and the prompt copy. No change to the geometry, `hemicycleRows`, `Hemicycle`, `OligarchySection`, any stylesheet, the server, `api.ts`, content or migrations.
* No existing test changes.
* Push only as the last paragraph says.

Push
After the STOP 1 ruling: fast-forward only, plain `git push`, the one commit. Report remote HEAD, the CI run and its Gate step, the Pages run, and the Railway server and worker deploys (nothing server-side changes; no migration). Close-out: dev servers and the throwaway Postgres stopped, tree clean at remote HEAD.
Report template

```
Committed: <SHA> web: bought seats sit with their own bench
Red first: <the two new tests failing on 6e958ca's layout, one line>
Gate: GATE GREEN at <SHA>, <wall time>, suite counts <shared/server/db/web/worker>
Captures: <path per surface, or the STOP>
Deviations: <none, or one line each>
Ruling items: <none, or one line each>

```
