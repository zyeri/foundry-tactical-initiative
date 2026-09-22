# Map Grouping - Plan B (Resizable Top Bar + Leftover Sweep) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user resize the top-bar tracker with a drag grip, and catch combatants that core Foundry leaves behind after a token is deleted; then cut v1.5.0-rc2.

**Architecture:** Pure helpers (`src/logic/bar-size.ts`, `src/logic/leftovers.ts`, `src/logic/tracker-view.ts`) and a DOM-only grip module (`src/ui/grip.ts`, happy-dom tests) carry the decisions. The top-bar adapter becomes a persistent wrapper (scrolling strip + persistent grip) scaled by one CSS variable. A new adapter (`src/adapter/leftovers.ts`) batches `deleteToken` events on the active GM and prompts only for combatants whose token is gone.

**Tech Stack:** TypeScript (strict), vitest 2 (node env; happy-dom per file for `src/ui`), esbuild, Foundry v14 + dnd5e 5.3.

**Spec:** `docs/superpowers/specs/2026-09-22-map-grouping-design.md` (Parts 2 and 3). Plan A (`2026-09-22-map-grouping-a.md`) is merged into this branch already.

## Global Constraints

- Foundry **v14** + **dnd5e 5.3+** only.
- Strict TDD for everything in `src/logic`, `src/ui`, and `src/death-service.ts`: failing test first. Only raw Foundry calls in `src/adapter` are untested (README checklist).
- Full JSDoc on every exported symbol, matching existing files. ASCII only, no emoji.
- Every async UI callback goes through `runSafe` (`src/ui/run-safe.ts`) or `guard` (`src/adapter/hooks.ts`). No bare `void` of a promise that can reject.
- Hook-driven automation is active-GM-only (`isActiveGM()` from `src/adapter/hooks.ts`).
- Bar size: `clampBarSize` rounds and clamps to **32..128**, default **44**; `NaN` -> 44; `+/-Infinity` clamps to the bound.
- Size setting: `SETTINGS.TOP_BAR_SIZE` = `"topBarSize"`, `scope: "user"`, `type: Number`, `default: 44`, `config: false`; written once on drag end, skipped if unchanged.
- Release: `module.json` and `package.json` version `1.5.0-rc2` (Task 6 only).
- Branch `feat/map-grouping`, worktree `C:/Users/zyery/projects/tactical-initiative-wt-map-grouping`.
- `npm run check` passes at the end of every task; commit `scripts/main.js(.map)` whenever the build changes it.
- Commit messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- A normal GM delete of an in-combat token must show NO module dialog (core already removed the combatant) (Task 1 test "a combatant whose token still exists is never a leftover" + Task 4 flush delay; README check).
- Deleting a boss token must surface a surviving end slot, not skip it because the start slot shares the token (Task 1 test "reports a surviving boss end slot").
- A combat update arriving mid-drag must not end or reset the resize (Task 2 test "strip redraw mid-drag does not end the drag").
- Dragging and releasing without moving must not write the setting (Task 2 test "no commit when the size did not change").
- A kept combatant whose token is gone must not break the next round's reroll for everyone after it (Task 4 `listCombatants` skips actorless combatants; README check).

---

### Task 1: Pure helpers - bar size, leftovers, missing-token flag

**Files:**
- Create: `src/logic/bar-size.ts`, `test/bar-size.test.ts`
- Create: `src/logic/leftovers.ts`, `test/leftovers.test.ts`
- Modify: `src/logic/tracker-view.ts` (`TrackerCombatant`, combatant `TrackerRow`, combatant branch of `buildTrackerView`)
- Modify: `test/tracker-view.test.ts` (helper `c()` + one test)

**Interfaces:**
- Produces:
  - `src/logic/bar-size.ts`: `BAR_MIN = 32`, `BAR_MAX = 128`, `BAR_DEFAULT = 44`, `clampBarSize(px: number): number`
  - `src/logic/leftovers.ts`: `interface LeftoverCandidate { combatId: string; combatantId: string; name: string; sceneId: string | null; tokenId: string | null }`; `interface DeletedTokenRef { sceneId: string; tokenId: string }`; `interface Leftover { combatId: string; combatantId: string; name: string }`; `findLeftovers(candidates: readonly LeftoverCandidate[], deleted: readonly DeletedTokenRef[], tokenExists: (sceneId: string, tokenId: string) => boolean): Leftover[]`
  - `src/logic/tracker-view.ts`: `TrackerCombatant.tokenMissing: boolean`; combatant `TrackerRow.tokenMissing: boolean`

- [ ] **Step 1: Write the failing tests.** Create `test/bar-size.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BAR_DEFAULT, BAR_MAX, BAR_MIN, clampBarSize } from "../src/logic/bar-size";

describe("clampBarSize", () => {
  it("keeps in-range sizes and rounds to whole pixels", () => {
    expect(clampBarSize(60)).toBe(60);
    expect(clampBarSize(60.4)).toBe(60);
    expect(clampBarSize(60.5)).toBe(61);
  });
  it("clamps to the bounds", () => {
    expect(clampBarSize(10)).toBe(BAR_MIN);
    expect(clampBarSize(500)).toBe(BAR_MAX);
    expect(clampBarSize(Number.POSITIVE_INFINITY)).toBe(BAR_MAX);
    expect(clampBarSize(Number.NEGATIVE_INFINITY)).toBe(BAR_MIN);
  });
  it("falls back to the default for NaN", () => {
    expect(clampBarSize(Number.NaN)).toBe(BAR_DEFAULT);
  });
  it("exposes the agreed bounds", () => {
    expect([BAR_MIN, BAR_DEFAULT, BAR_MAX]).toEqual([32, 44, 128]);
  });
});
```

Create `test/leftovers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findLeftovers, type LeftoverCandidate } from "../src/logic/leftovers";

function cand(over: Partial<LeftoverCandidate> & { combatantId: string }): LeftoverCandidate {
  return {
    combatId: over.combatId ?? "c1",
    combatantId: over.combatantId,
    name: over.name ?? over.combatantId,
    sceneId: over.sceneId === undefined ? "s1" : over.sceneId,
    tokenId: over.tokenId === undefined ? "t1" : over.tokenId
  };
}

const gone = (): boolean => false;
const present = (): boolean => true;

describe("findLeftovers", () => {
  it("reports a combatant whose deleted token no longer exists", () => {
    const result = findLeftovers([cand({ combatantId: "a" })], [{ sceneId: "s1", tokenId: "t1" }], gone);
    expect(result).toEqual([{ combatId: "c1", combatantId: "a", name: "a" }]);
  });

  it("a combatant whose token still exists is never a leftover", () => {
    expect(findLeftovers([cand({ combatantId: "a" })], [{ sceneId: "s1", tokenId: "t1" }], present)).toEqual([]);
  });

  it("reports a surviving boss end slot that shares the deleted tokenId", () => {
    const result = findLeftovers(
      [cand({ combatantId: "start", name: "Ogre" }), cand({ combatantId: "end", name: "Ogre" })],
      [{ sceneId: "s1", tokenId: "t1" }],
      gone
    );
    expect(result.map((r) => r.combatantId)).toEqual(["start", "end"]);
  });

  it("covers the same token in two combats, in input order", () => {
    const result = findLeftovers(
      [cand({ combatantId: "x", combatId: "c1" }), cand({ combatantId: "y", combatId: "c2" })],
      [{ sceneId: "s1", tokenId: "t1" }],
      gone
    );
    expect(result).toEqual([
      { combatId: "c1", combatantId: "x", name: "x" },
      { combatId: "c2", combatantId: "y", name: "y" }
    ]);
  });

  it("ignores other scenes, other tokens, and combatants without a token", () => {
    const result = findLeftovers(
      [
        cand({ combatantId: "other-scene", sceneId: "s2" }),
        cand({ combatantId: "other-token", tokenId: "t9" }),
        cand({ combatantId: "no-token", tokenId: null }),
        cand({ combatantId: "no-scene", sceneId: null })
      ],
      [{ sceneId: "s1", tokenId: "t1" }],
      gone
    );
    expect(result).toEqual([]);
  });

  it("deduplicates repeated deletions and repeated candidates", () => {
    const result = findLeftovers(
      [cand({ combatantId: "a" }), cand({ combatantId: "a" })],
      [
        { sceneId: "s1", tokenId: "t1" },
        { sceneId: "s1", tokenId: "t1" }
      ],
      gone
    );
    expect(result).toHaveLength(1);
  });

  it("returns nothing for an empty queue", () => {
    expect(findLeftovers([cand({ combatantId: "a" })], [], gone)).toEqual([]);
  });
});
```

In `test/tracker-view.test.ts`, add `tokenMissing: over.tokenMissing ?? false` as the last property of the object returned by `c()`, and append inside the `describe` block:

```ts
  it("carries tokenMissing on a combatant row", () => {
    const rows = buildTrackerView(input([c({ id: "ghost", tokenMissing: true }), c({ id: "ok" })]), GM);
    expect(rows[0]).toMatchObject({ kind: "combatant", tokenMissing: true });
    expect(rows[1]).toMatchObject({ kind: "combatant", tokenMissing: false });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/bar-size.test.ts test/leftovers.test.ts test/tracker-view.test.ts`
Expected: FAIL (modules not found; `tokenMissing` missing on rows).

- [ ] **Step 3: Implement.** Create `src/logic/bar-size.ts`:

```ts
/**
 * @file Pure top-bar size rules: bounds, default, and clamping for the
 * user-resizable portrait size. No Foundry globals.
 */

/** Smallest portrait size, px. */
export const BAR_MIN = 32;
/** Largest portrait size, px. */
export const BAR_MAX = 128;
/** Default portrait size, px (the v1.5.0 fixed size). */
export const BAR_DEFAULT = 44;

/**
 * Round and clamp a requested portrait size. `NaN` falls back to the default;
 * infinities clamp to the nearest bound.
 *
 * @param px - Requested size in pixels.
 * @returns A whole-pixel size within {@link BAR_MIN}..{@link BAR_MAX}.
 */
export function clampBarSize(px: number): number {
  if (Number.isNaN(px)) return BAR_DEFAULT;
  return Math.min(BAR_MAX, Math.max(BAR_MIN, Math.round(px)));
}
```

Create `src/logic/leftovers.ts`:

```ts
/**
 * @file Pure detection of combatants left behind after their token was deleted
 * (core Foundry normally removes them; this finds what it missed). No Foundry
 * globals; the adapter supplies candidates and a token-existence check.
 */

/** A combatant that might have lost its token. */
export interface LeftoverCandidate {
  combatId: string;
  combatantId: string;
  name: string;
  sceneId: string | null;
  tokenId: string | null;
}

/** A deleted token, as reported by the deleteToken hook. */
export interface DeletedTokenRef {
  sceneId: string;
  tokenId: string;
}

/** A combatant to offer for removal. */
export interface Leftover {
  combatId: string;
  combatantId: string;
  name: string;
}

/**
 * Candidates whose (scene, token) was deleted and whose token no longer exists,
 * in input order, one entry per combatant.
 *
 * @param candidates - Combatants of every combat, in combat then turn order.
 * @param deleted - Deleted tokens collected since the last flush.
 * @param tokenExists - Whether a token still exists on its scene.
 * @returns The leftovers to offer for removal.
 */
export function findLeftovers(
  candidates: readonly LeftoverCandidate[],
  deleted: readonly DeletedTokenRef[],
  tokenExists: (sceneId: string, tokenId: string) => boolean
): Leftover[] {
  const keys = new Set(deleted.map((ref) => `${ref.sceneId}.${ref.tokenId}`));
  const seen = new Set<string>();
  const result: Leftover[] = [];
  for (const candidate of candidates) {
    const { sceneId, tokenId } = candidate;
    if (sceneId === null || tokenId === null) continue;
    if (!keys.has(`${sceneId}.${tokenId}`)) continue;
    if (tokenExists(sceneId, tokenId)) continue;
    const id = `${candidate.combatId}.${candidate.combatantId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ combatId: candidate.combatId, combatantId: candidate.combatantId, name: candidate.name });
  }
  return result;
}
```

In `src/logic/tracker-view.ts`:
- Add to `TrackerCombatant` (after `conditions`):

```ts
  /** True when the combatant's token no longer exists on its scene. */
  tokenMissing: boolean;
```

- Add to the combatant variant of `TrackerRow` (after `isDefeated: boolean;`):

```ts
      /** True when the combatant's token no longer exists on its scene. */
      tokenMissing: boolean;
```

- In the combatant branch of `buildTrackerView`, add `tokenMissing: combatant.tokenMissing` after `isDefeated: combatant.isDefeated`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/bar-size.test.ts test/leftovers.test.ts test/tracker-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Keep the build compiling.** `src/adapter/top-bar.ts` `toCombatant` now misses `tokenMissing`. Add a temporary-free, correct value there now:

```ts
    conditions: actor?.statuses ? [...actor.statuses] : [],
    tokenMissing:
      combatant.sceneId !== null &&
      combatant.tokenId !== null &&
      game.scenes?.get(combatant.sceneId)?.tokens.has(combatant.tokenId) === false
```

and declare in `src/foundry-env.d.ts` `FoundryGame`:

```ts
  /** World scenes (subset): token existence lookup. */
  readonly scenes?: FoundryCollection<{ id: string; tokens: { has(id: string): boolean } }> | null;
```

(`=== false` keeps an unknown scene from being flagged.)

- [ ] **Step 6: Full check + commit**

Run: `npm run check` (green)

```bash
git add src test scripts/main.js scripts/main.js.map
git commit -m "feat: pure bar-size clamp, leftover-combatant detection, tokenMissing flag"
```

---

### Task 2: Resize grip (DOM module, happy-dom tests)

**Files:**
- Create: `src/ui/grip.ts`
- Create: `test/ui-grip.test.ts`

**Interfaces:**
- Produces (`src/ui/grip.ts`):

```ts
export interface GripOptions {
  read(): number;              // current applied size
  preview(px: number): void;   // apply a size live (no persistence)
  commit(px: number): void;    // persist a final size
  clamp(px: number): number;
  min: number;
  max: number;
  defaultSize: number;
  step: number;                // keyboard step, px
}
export function attachGrip(grip: HTMLElement, options: GripOptions): () => void; // returns detach
```

- [ ] **Step 1: Write the failing tests.** Create `test/ui-grip.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { attachGrip, type GripOptions } from "../src/ui/grip";

let size: number;
let previews: number[];
let commits: number[];
let grip: HTMLElement;
let strip: HTMLElement;

function options(): GripOptions {
  return {
    read: () => size,
    preview: (px) => {
      size = px;
      previews.push(px);
    },
    commit: (px) => commits.push(px),
    clamp: (px) => Math.min(128, Math.max(32, Math.round(px))),
    min: 32,
    max: 128,
    defaultSize: 44,
    step: 4
  };
}

function pointer(type: string, clientY: number): void {
  grip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY, pointerId: 1 }));
}

beforeEach(() => {
  document.body.replaceChildren();
  const bar = document.createElement("div");
  strip = document.createElement("div");
  grip = document.createElement("div");
  bar.append(strip, grip);
  document.body.appendChild(bar);
  size = 44;
  previews = [];
  commits = [];
  attachGrip(grip, options());
});

describe("attachGrip", () => {
  it("dragging down grows the size live and commits once on release", () => {
    pointer("pointerdown", 100);
    pointer("pointermove", 110);
    pointer("pointermove", 120);
    pointer("pointerup", 120);
    expect(previews).toEqual([54, 64]);
    expect(commits).toEqual([64]);
  });

  it("clamps while dragging", () => {
    pointer("pointerdown", 100);
    pointer("pointermove", 400);
    pointer("pointerup", 400);
    expect(commits).toEqual([128]);
  });

  it("no commit when the size did not change", () => {
    pointer("pointerdown", 100);
    pointer("pointerup", 100);
    expect(commits).toEqual([]);
  });

  it("ignores moves when no drag is active", () => {
    pointer("pointermove", 150);
    expect(previews).toEqual([]);
  });

  it("lostpointercapture ends the drag and commits", () => {
    pointer("pointerdown", 100);
    pointer("pointermove", 90);
    grip.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }));
    pointer("pointermove", 50);
    expect(commits).toEqual([34]);
    expect(previews).toEqual([34]);
  });

  it("strip redraw mid-drag does not end the drag", () => {
    pointer("pointerdown", 100);
    strip.replaceChildren(document.createElement("span"));
    pointer("pointermove", 116);
    pointer("pointerup", 116);
    expect(commits).toEqual([60]);
  });

  it("pointerdown does not bubble to the bar", () => {
    let bubbled = false;
    grip.parentElement?.addEventListener("pointerdown", () => {
      bubbled = true;
    });
    pointer("pointerdown", 100);
    expect(bubbled).toBe(false);
  });

  it("double-click resets to the default and cancels an active drag", () => {
    size = 80;
    pointer("pointerdown", 100);
    grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    pointer("pointerup", 140);
    expect(commits).toEqual([44]);
    expect(size).toBe(44);
  });

  it("keyboard: ArrowDown grows, ArrowUp shrinks, Home resets", () => {
    const key = (k: string): void => {
      grip.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    };
    key("ArrowDown");
    key("ArrowUp");
    key("ArrowUp");
    key("Home");
    expect(commits).toEqual([48, 44, 40, 44]);
  });

  it("exposes slider semantics for assistive tech", () => {
    expect(grip.getAttribute("role")).toBe("separator");
    expect(grip.tabIndex).toBe(0);
    expect(grip.getAttribute("aria-valuemin")).toBe("32");
    expect(grip.getAttribute("aria-valuemax")).toBe("128");
    pointer("pointerdown", 100);
    pointer("pointermove", 120);
    expect(grip.getAttribute("aria-valuenow")).toBe("64");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/ui-grip.test.ts`
Expected: FAIL, cannot resolve `../src/ui/grip`.

- [ ] **Step 3: Implement.** Create `src/ui/grip.ts`:

```ts
/**
 * @file A vertical resize grip with no Foundry dependencies, tested under
 * happy-dom. Dragging down grows the size, up shrinks it; the size is applied
 * live via `preview` and persisted once via `commit` when the drag ends (only
 * if it changed). Double-click resets; ArrowDown/ArrowUp/Home work when focused.
 * The grip must live outside any element that is rebuilt on redraw.
 */

/** Callbacks and bounds for {@link attachGrip}. */
export interface GripOptions {
  /** Current applied size, px. */
  read(): number;
  /** Apply a size live (no persistence). */
  preview(px: number): void;
  /** Persist a final size. */
  commit(px: number): void;
  /** Round and clamp a requested size. */
  clamp(px: number): number;
  /** Smallest size, px (for aria). */
  min: number;
  /** Largest size, px (for aria). */
  max: number;
  /** Size restored by double-click and Home. */
  defaultSize: number;
  /** Keyboard step, px. */
  step: number;
}

/**
 * Wire a resize grip element.
 *
 * @param grip - The grip element (persistent across redraws).
 * @param options - Size callbacks and bounds.
 * @returns A function that removes every listener.
 */
export function attachGrip(grip: HTMLElement, options: GripOptions): () => void {
  let dragging = false;
  let startY = 0;
  let startSize = 0;
  let current = 0;

  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-orientation", "horizontal");
  grip.setAttribute("aria-valuemin", String(options.min));
  grip.setAttribute("aria-valuemax", String(options.max));
  grip.setAttribute("aria-valuenow", String(options.read()));
  grip.tabIndex = 0;

  const apply = (px: number): void => {
    options.preview(px);
    grip.setAttribute("aria-valuenow", String(px));
  };

  const set = (px: number): void => {
    const next = options.clamp(px);
    const before = options.read();
    apply(next);
    if (next !== before) options.commit(next);
  };

  const onDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    startY = event.clientY;
    startSize = options.read();
    current = startSize;
    if (typeof grip.setPointerCapture === "function") {
      try {
        grip.setPointerCapture(event.pointerId);
      } catch {
        // Capture is best-effort; moves still arrive while the pointer is over the grip.
      }
    }
  };

  const onMove = (event: PointerEvent): void => {
    if (!dragging) return;
    current = options.clamp(startSize + (event.clientY - startY));
    apply(current);
  };

  const onEnd = (): void => {
    if (!dragging) return;
    dragging = false;
    if (current !== startSize) options.commit(current);
  };

  const onDblClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    dragging = false;
    set(options.defaultSize);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown") set(options.read() + options.step);
    else if (event.key === "ArrowUp") set(options.read() - options.step);
    else if (event.key === "Home") set(options.defaultSize);
    else return;
    event.preventDefault();
  };

  grip.addEventListener("pointerdown", onDown);
  grip.addEventListener("pointermove", onMove);
  grip.addEventListener("pointerup", onEnd);
  grip.addEventListener("pointercancel", onEnd);
  grip.addEventListener("lostpointercapture", onEnd);
  grip.addEventListener("dblclick", onDblClick);
  grip.addEventListener("keydown", onKey);

  return () => {
    grip.removeEventListener("pointerdown", onDown);
    grip.removeEventListener("pointermove", onMove);
    grip.removeEventListener("pointerup", onEnd);
    grip.removeEventListener("pointercancel", onEnd);
    grip.removeEventListener("lostpointercapture", onEnd);
    grip.removeEventListener("dblclick", onDblClick);
    grip.removeEventListener("keydown", onKey);
  };
}
```

Note for the dblclick test: size is 80 when the drag starts, so `set(44)` commits 44 (80 -> 44 changed), and the later `pointerup` does nothing because `dragging` is false.

Note for the keyboard test: starting at 44: ArrowDown -> 48, ArrowUp -> 44, ArrowUp -> 40, Home -> 44 (40 -> 44 changed), so every step commits.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/ui-grip.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Full check + commit**

Run: `npm run check`

```bash
git add src/ui/grip.ts test/ui-grip.test.ts
git commit -m "feat: vertical resize grip module with happy-dom tests"
```

(The bundle does not change: nothing imports `grip.ts` until Task 3.)

---

### Task 3: Resizable top bar (setting, structure, CSS scaling)

**Files:**
- Modify: `src/constants.ts` (`SETTINGS.TOP_BAR_SIZE`)
- Modify: `src/settings.ts` (register + `getTopBarSize`)
- Modify: `src/foundry-env.d.ts` (`FoundrySettings.set`)
- Modify: `src/adapter/top-bar.ts` (`container`, `render`, grip wiring)
- Modify: `styles/tactical-initiative.css` (top-bar block)
- Modify: `lang/en.json`

**Interfaces:**
- Consumes: `clampBarSize`, `BAR_MIN`, `BAR_MAX`, `BAR_DEFAULT` (Task 1); `attachGrip` (Task 2); `runSafe`.
- Produces: `SETTINGS.TOP_BAR_SIZE = "topBarSize"`; `getTopBarSize(): number` in `src/settings.ts`.

- [ ] **Step 1: Setting.** In `src/constants.ts` `SETTINGS`, add after `PLAYER_HP_POLICY`:

```ts
  /** User setting (hidden): top-bar portrait size in px, set by the resize grip. */
  TOP_BAR_SIZE: "topBarSize"
```

(add the comma after the previous entry). In `src/foundry-env.d.ts` `FoundrySettings`, add `set(namespace: string, key: string, value: unknown): Promise<unknown>;`. In `src/settings.ts`, import `{ BAR_DEFAULT, clampBarSize } from "./logic/bar-size"`, register at the end of `registerSettings`:

```ts
  game.settings.register(MODULE_ID, SETTINGS.TOP_BAR_SIZE, {
    name: "TACTICAL_INITIATIVE.Settings.TopBarSize.Name",
    scope: "user",
    config: false,
    type: Number,
    default: BAR_DEFAULT
  });
```

and append:

```ts
/**
 * The user's top-bar portrait size, clamped to the allowed range.
 *
 * @returns Size in px (44 when unset or invalid).
 */
export function getTopBarSize(): number {
  const raw = game.settings.get(MODULE_ID, SETTINGS.TOP_BAR_SIZE);
  return clampBarSize(typeof raw === "number" ? raw : BAR_DEFAULT);
}
```

- [ ] **Step 2: Bar structure.** In `src/adapter/top-bar.ts` add imports:

```ts
import { BAR_DEFAULT, BAR_MAX, BAR_MIN, clampBarSize } from "../logic/bar-size";
import { getTopBarSize } from "../settings";
import { attachGrip } from "../ui/grip";
```

Replace `container()` with:

```ts
/** Class of the scrolling strip that render() rebuilds. */
const STRIP_CLASS = `${MODULE_ID}-tb-strip`;

/** The size currently applied to the bar, px. */
let barSize = BAR_DEFAULT;

/** Apply a portrait size to the bar wrapper. */
function applySize(bar: HTMLElement, px: number): void {
  bar.style.setProperty("--ti-portrait", `${px}px`);
}

/**
 * Get or create the bar: a persistent wrapper under #ui-top (falling back to
 * body) holding a strip that render() rebuilds and a persistent resize grip.
 *
 * @returns The wrapper and its strip.
 */
function container(): { bar: HTMLElement; strip: HTMLElement } {
  const existing = document.getElementById(CONTAINER_ID);
  const existingStrip = existing?.querySelector<HTMLElement>(`.${STRIP_CLASS}`);
  if (existing && existingStrip) return { bar: existing, strip: existingStrip };
  const bar = document.createElement("div");
  bar.id = CONTAINER_ID;
  bar.className = `${MODULE_ID}-top-bar`;
  const strip = document.createElement("div");
  strip.className = STRIP_CLASS;
  const grip = document.createElement("div");
  grip.className = `${MODULE_ID}-tb-grip`;
  grip.title = game.i18n.localize("TACTICAL_INITIATIVE.Tracker.ResizeGrip");
  bar.append(strip, grip);
  barSize = getTopBarSize();
  applySize(bar, barSize);
  attachGrip(grip, {
    read: () => barSize,
    preview: (px) => {
      barSize = px;
      applySize(bar, px);
    },
    commit: (px) => {
      void runSafe("top-bar size", () => game.settings.set(MODULE_ID, SETTINGS.TOP_BAR_SIZE, px));
    },
    clamp: clampBarSize,
    min: BAR_MIN,
    max: BAR_MAX,
    defaultSize: BAR_DEFAULT,
    step: 4
  });
  (document.getElementById("ui-top") ?? document.body).appendChild(bar);
  return { bar, strip };
}
```

Replace the body of `render()`'s `try` block with:

```ts
    const { bar, strip } = container();
    applySize(bar, barSize);
    const combat = game.combats?.active ?? null;
    if (!combat || !enabled()) {
      bar.hidden = true;
      strip.replaceChildren();
      document.querySelectorAll(`.${POPOVER_CLASS}`).forEach((el) => el.remove());
      return;
    }
    const rows = buildTrackerView(toInput(combat), viewer());
    strip.replaceChildren(...rows.map(renderRow));
    if (game.user?.isGM === true) strip.appendChild(renderControls(combat));
    bar.hidden = false;
    renderPopovers(strip, rows);
```

(`renderPopovers` already takes the element to search for group cells; passing the strip keeps that working.)

- [ ] **Step 3: i18n.** In `lang/en.json` add:

```json
  "TACTICAL_INITIATIVE.Tracker.ResizeGrip": "Drag to resize (double-click to reset; arrow keys when focused)",
  "TACTICAL_INITIATIVE.Settings.TopBarSize.Name": "Top-bar portrait size",
```

- [ ] **Step 4: CSS.** In `styles/tactical-initiative.css`, replace every rule from `/* Top-bar combat tracker (B2). */` through the end of the `.tactical-initiative-tb-round` rule with:

```css
/* Top-bar combat tracker (B2). Every size scales with --ti-portrait (default 44px). */
.tactical-initiative-top-bar {
  --ti-portrait: 44px;
  position: relative;
  width: fit-content;
  max-width: 90vw;
  margin: 0 auto;
  padding-right: 14px;
  pointer-events: all;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 0 0 0.4em 0.4em;
}

.tactical-initiative-tb-strip {
  display: flex;
  align-items: flex-end;
  gap: 0.25em;
  padding: calc(var(--ti-portrait) * 6 / 44 + 3px) 0.4em 0.2em;
  overflow-x: auto;
  overflow-y: hidden;
}

.tactical-initiative-tb-grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: ns-resize;
  touch-action: none;
  border-bottom-right-radius: 0.4em;
  background: linear-gradient(
    135deg,
    transparent 55%,
    rgba(255, 255, 255, 0.55) 55%,
    rgba(255, 255, 255, 0.55) 65%,
    transparent 65%,
    transparent 78%,
    rgba(255, 255, 255, 0.55) 78%,
    rgba(255, 255, 255, 0.55) 88%,
    transparent 88%
  );
}

.tactical-initiative-tb-grip:focus-visible {
  outline: 2px solid var(--color-warning, #d9a520);
}

.tactical-initiative-tb-row {
  position: relative;
  width: var(--ti-portrait);
  height: var(--ti-portrait);
  flex: 0 0 auto;
  border: calc(var(--ti-portrait) / 22) solid rgba(255, 255, 255, 0.4);
  border-radius: calc(var(--ti-portrait) / 11);
  background-size: cover;
  background-position: center;
  cursor: pointer;
}

.tactical-initiative-tb-current {
  outline: calc(var(--ti-portrait) / 22) solid var(--color-warning, #d9a520);
  transform: translateY(calc(var(--ti-portrait) * -3 / 44)) scale(1.08);
}

.tactical-initiative-tb-defeated {
  filter: grayscale(1) brightness(0.6);
}

.tactical-initiative-tb-hp {
  position: absolute;
  left: 0;
  bottom: 0;
  height: calc(var(--ti-portrait) / 11);
  background: #c0392b;
}

.tactical-initiative-tb-hp-text {
  position: absolute;
  bottom: calc(var(--ti-portrait) / 11);
  width: 100%;
  text-align: center;
  font-size: max(9px, calc(var(--ti-portrait) * 9 / 44));
  color: #fff;
  text-shadow: 0 0 2px #000;
}

.tactical-initiative-tb-count,
.tactical-initiative-tb-cond {
  position: absolute;
  top: calc(var(--ti-portrait) * -6 / 44);
  padding: 0 calc(var(--ti-portrait) * 3 / 44);
  border-radius: calc(var(--ti-portrait) * 6 / 44);
  color: #fff;
  font-size: max(9px, calc(var(--ti-portrait) * 9 / 44));
}

.tactical-initiative-tb-count {
  right: calc(var(--ti-portrait) * -6 / 44);
  background: #222;
}

.tactical-initiative-tb-cond {
  left: calc(var(--ti-portrait) * -6 / 44);
  background: #6a1b9a;
}

.tactical-initiative-tb-controls {
  display: flex;
  align-items: center;
  gap: 0.2em;
  margin-left: 0.5em;
}

.tactical-initiative-tb-btn {
  width: calc(var(--ti-portrait) * 0.6);
  height: calc(var(--ti-portrait) * 0.6);
  padding: 0;
  line-height: 1;
  font-size: max(9px, calc(var(--ti-portrait) * 0.3));
}

.tactical-initiative-tb-round {
  color: #fff;
  font-size: max(9px, calc(var(--ti-portrait) / 4));
  margin-right: 0.3em;
}
```

In the group-cell block (after `/* Top-bar group cell ... */`), change `.tactical-initiative-tb-group-name` `font-size: 9px;` to `font-size: max(9px, calc(var(--ti-portrait) * 9 / 44));`.

- [ ] **Step 5: Full check + commit**

Run: `npm run check` (green)
Run: `grep -n "44px\|9px;" styles/tactical-initiative.css`
Expected: only `--ti-portrait: 44px;` and `max(9px, ...)` occurrences remain in top-bar rules (the popover image's `24px` is intentional).

```bash
git add src lang styles scripts/main.js scripts/main.js.map
git commit -m "feat: resizable top bar via a persistent drag grip (per-user size)"
```

---

### Task 4: Leftover-combatant sweep + missing-token marker

**Files:**
- Create: `src/adapter/leftovers.ts`
- Modify: `src/adapter/top-bar.ts` (`renderRow` combatant branch: marker)
- Modify: `src/adapter/foundry-adapter.ts:57-73` (`listCombatants` skips actorless)
- Modify: `src/main.ts`
- Modify: `styles/tactical-initiative.css`, `lang/en.json`
- Modify: `docs/superpowers/specs/2026-09-22-map-grouping-design.md` (flush delay)

**Interfaces:**
- Consumes: `findLeftovers`, `LeftoverCandidate`, `DeletedTokenRef`, `Leftover` (Task 1); `isActiveGM`, `guard` (`src/adapter/hooks.ts`); `TrackerRow.tokenMissing` (Task 1).
- Produces: `registerLeftoverSweep(): void` in `src/adapter/leftovers.ts`.

- [ ] **Step 1: Sweep adapter.** Create `src/adapter/leftovers.ts`:

```ts
/**
 * @file Safety net for token deletion: core Foundry removes a deleted token's
 * combatants; this catches any it left behind. The active GM collects deleted
 * tokens, waits for core's own deletes to land, then asks once (Remove / Keep)
 * for every combatant whose token is gone. Foundry boundary: the detection is
 * tested in test/leftovers.test.ts; this wiring is on the README checklist.
 */

import { findLeftovers, type DeletedTokenRef, type LeftoverCandidate } from "../logic/leftovers";
import { guard, isActiveGM } from "./hooks";

/**
 * Delay before checking, ms. Long enough for core's own combatant deletes
 * (issued by whichever client deleted the token) to reach the active GM, so a
 * normal delete never prompts; also batches multi-token deletes.
 */
const FLUSH_DELAY_MS = 1000;

/** Deleted tokens waiting for the next flush. */
let queue: DeletedTokenRef[] = [];

/** Pending flush timer, if any. */
let timer: ReturnType<typeof setTimeout> | null = null;

/** Escape text for DialogV2 HTML content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Whether a token still exists on its scene (unknown scene counts as gone). */
function tokenExists(sceneId: string, tokenId: string): boolean {
  return game.scenes?.get(sceneId)?.tokens.has(tokenId) === true;
}

/** Every combatant of every combat, as leftover candidates. */
function candidates(): LeftoverCandidate[] {
  return (game.combats?.contents ?? []).flatMap((combat) =>
    combat.turns.map((c) => ({
      combatId: combat.id,
      combatantId: c.id,
      name: c.name,
      sceneId: c.sceneId,
      tokenId: c.tokenId
    }))
  );
}

/** Check the queued deletions and, if any combatant was left behind, ask. */
async function flush(): Promise<void> {
  const deleted = queue;
  queue = [];
  timer = null;
  const leftovers = findLeftovers(candidates(), deleted, tokenExists);
  if (leftovers.length === 0) return;
  const names = leftovers.map((l) => `<li>${escapeHtml(l.name)}</li>`).join("");
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("TACTICAL_INITIATIVE.Leftover.Title") },
    content: `<p>${escapeHtml(game.i18n.localize("TACTICAL_INITIATIVE.Leftover.Body"))}</p><ul>${names}</ul>`,
    buttons: [
      { action: "remove", label: game.i18n.localize("TACTICAL_INITIATIVE.Leftover.Remove"), default: true },
      { action: "keep", label: game.i18n.localize("TACTICAL_INITIATIVE.Leftover.Keep") }
    ],
    rejectClose: false,
    modal: true
  });
  if (choice !== "remove") return;
  const byCombat = new Map<string, string[]>();
  for (const leftover of leftovers) {
    const combat = game.combats?.get(leftover.combatId);
    // Re-fetch: another GM, core, or a boss-pair cascade may have removed it meanwhile.
    if (!combat?.combatants.get(leftover.combatantId)) continue;
    byCombat.set(leftover.combatId, [...(byCombat.get(leftover.combatId) ?? []), leftover.combatantId]);
  }
  for (const [combatId, ids] of byCombat) {
    const combat = game.combats?.get(combatId);
    const still = ids.filter((id) => combat?.combatants.get(id));
    if (combat && still.length > 0) await combat.deleteEmbeddedDocuments("Combatant", still);
  }
}

/**
 * Register the deleteToken safety net (call at `init`). Runs on the active GM
 * only, whoever deleted the token. Emptied groups are swept by the existing
 * deleteCombatant hook.
 */
export function registerLeftoverSweep(): void {
  Hooks.on("deleteToken", (token: FoundryTokenDocument): void => {
    if (!isActiveGM()) return;
    const sceneId = token.parent?.id ?? null;
    if (sceneId === null) return;
    queue.push({ sceneId, tokenId: token.id });
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      guard("leftover sweep", flush);
    }, FLUSH_DELAY_MS);
  });
}
```
- [ ] **Step 2: Register.** In `src/main.ts`, import `registerLeftoverSweep` from `"./adapter/leftovers"` and call it in `init` after `registerTopBar();`.

- [ ] **Step 3: Missing-token marker.** In `src/adapter/top-bar.ts` `renderRow` combatant branch, after the `isDefeated` class line add:

```ts
    if (row.tokenMissing) {
      li.classList.add(`${MODULE_ID}-tb-missing`);
      const mark = document.createElement("span");
      mark.className = `${MODULE_ID}-tb-missing-mark`;
      mark.textContent = "?";
      li.appendChild(mark);
    }
```

and change the `li.title = row.name;` line in that branch to:

```ts
    li.title = row.tokenMissing
      ? `${row.name} (${game.i18n.localize("TACTICAL_INITIATIVE.Leftover.Marker")})`
      : row.name;
```

Append to `styles/tactical-initiative.css`:

```css
/* Combatant whose token was deleted but was kept in combat. */
.tactical-initiative-tb-missing {
  border-style: dashed;
  opacity: 0.7;
}

.tactical-initiative-tb-missing-mark {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: bold;
  font-size: max(12px, calc(var(--ti-portrait) * 0.5));
  text-shadow: 0 0 3px #000;
}
```

- [ ] **Step 4: Kept combatants cannot break rerolls.** In `src/adapter/foundry-adapter.ts` `listCombatants`, change `return this.combat.combatants.contents.map(` to:

```ts
    // A combatant with no actor (e.g. kept after its unlinked token was deleted)
    // cannot roll; skip it so it cannot break the reroll for everyone after it.
    return this.combat.combatants.contents.filter((combatant) => combatant.actor !== null).map(
```

- [ ] **Step 5: i18n.** Add to `lang/en.json`:

```json
  "TACTICAL_INITIATIVE.Leftover.Title": "Combatants without a token",
  "TACTICAL_INITIATIVE.Leftover.Body": "These combatants lost their token. Remove them from combat?",
  "TACTICAL_INITIATIVE.Leftover.Remove": "Remove",
  "TACTICAL_INITIATIVE.Leftover.Keep": "Keep",
  "TACTICAL_INITIATIVE.Leftover.Marker": "token deleted",
```

- [ ] **Step 6: Spec note.** In the spec's Part 3 "Batch." bullet, replace `` `foundry.utils.debounce(flush, 250)` flushes it`` with `` a module timer flushes it 1000 ms after the last deletion (plain `setTimeout`; 250 ms risked prompting before core's own combatant deletes reached the active GM)``.

- [ ] **Step 7: Full check + commit**

Run: `npm run check` (green)

```bash
git add src lang styles docs scripts/main.js scripts/main.js.map
git commit -m "feat: leftover-combatant sweep after token deletion, missing-token marker"
```

---

### Task 5: restoreMob warns when the token is gone

**Files:**
- Modify: `src/death-service.ts:66-79` (port), `:132-134` (`restoreMob`)
- Modify: `test/fake-death-port.ts`, `test/death-service.test.ts:137-140`
- Modify: `src/adapter/combat-events.ts` (port method), `lang/en.json`

**Interfaces:**
- Produces: `DeathPort.warnRestoreNoToken(): void`.

- [ ] **Step 1: Write the failing test.** In `test/death-service.test.ts`, replace the test "does nothing when the token uuid cannot be resolved" with:

```ts
  it("warns and does nothing else when the token uuid cannot be resolved", async () => {
    await service.restoreMob("Scene.s.Token.gone", "c1");
    expect(port.unhidden).toEqual([]);
    expect(port.added).toEqual([]);
    expect(port.warnedNoToken).toBe(1);
  });
```

In `test/fake-death-port.ts`, add a field `public warnedNoToken = 0;` next to `warnedNoCombat`, and a method:

```ts
  public warnRestoreNoToken(): void {
    this.warnedNoToken += 1;
  }
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/death-service.test.ts`
Expected: FAIL on `expect(port.warnedNoToken).toBe(1)` (received 0), because `restoreMob` does not call the new port method yet.

- [ ] **Step 3: Implement.** In `src/death-service.ts` `DeathPort`, after `warnRestoreNoCombat(): void;` add:

```ts
  /** Notify the GM that the token to restore no longer exists. */
  warnRestoreNoToken(): void;
```

In `restoreMob`, replace `if (!token) return;` with:

```ts
    if (!token) {
      this.port.warnRestoreNoToken();
      return;
    }
```

In `src/adapter/combat-events.ts`, after `warnRestoreNoCombat()` add:

```ts
  public warnRestoreNoToken(): void {
    ui.notifications?.warn(game.i18n.localize("TACTICAL_INITIATIVE.Chat.RestoreNoToken"));
  }
```

Add to `lang/en.json` after `"TACTICAL_INITIATIVE.Chat.RestoreNoCombat"`:

```json
  "TACTICAL_INITIATIVE.Chat.RestoreNoToken": "That token no longer exists; nothing to restore.",
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/death-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check + commit**

Run: `npm run check`

```bash
git add src test lang scripts/main.js scripts/main.js.map
git commit -m "fix: warn when restoring a mob whose token was deleted"
```

---

### Task 6: v1.5.0-rc2 release prep (version, README)

**Files:**
- Modify: `module.json:5`, `package.json:3`, `package-lock.json` (root `version` fields)
- Modify: `README.md` (append Plan B checklist after the Map grouping checklist)

- [ ] **Step 1: Version.** Set `"version": "1.5.0-rc2"` in `module.json` and `package.json`, then run `npm install --package-lock-only` so `package-lock.json` matches.

Run: `grep -n '"version"' module.json package.json && node -e "console.log(require('./package-lock.json').version)"`
Expected: all three show `1.5.0-rc2`.

- [ ] **Step 2: README.** Rename the heading `## Map grouping checklist (v1.5.0-rc2, Plan A)` to `## Map grouping checklist (v1.5.0-rc2)` and append these items to that list (continue its numbering):

```markdown
- **Resize.** Drag the grip at the bar's bottom-right corner down and up: portraits, badges,
  HP bars, round label and turn buttons all scale together (32-128px). Change HP on a
  combatant mid-drag: the drag continues. Reload: the size persists. Log in as the same user
  on another browser: same size. Double-click the grip: back to 44px. Focus the grip (Tab)
  and use ArrowUp/ArrowDown/Home.
- **Size footprint.** At 128px with 10+ combatants the strip scrolls horizontally and does
  not cover notifications or scene navigation.
- **Normal delete, no module prompt.** Delete an in-combat token (Delete key, confirm core's
  dialog): the combatant disappears and NO "Combatants without a token" dialog appears.
- **Leftover sweep.** Reproduce the original leftover case (see the spec's P0 probe results).
  Within about a second the dialog lists the leftover(s). Remove: they leave the tracker.
  Keep: the portrait turns dashed with a "?" and its tooltip says "token deleted"; the next
  round's reroll still gives everyone else initiative.
- **Boss delete.** Delete a Boss token: no end-slot entry survives (or, if one does, the
  dialog offers it).
- **Restore a deleted mob.** Kill a mob (F4 hides it and whispers Restore), delete its token,
  then click Restore: a warning says the token no longer exists.
```

- [ ] **Step 3: Full check + commit**

Run: `npm run check`

```bash
git add module.json package.json package-lock.json README.md scripts/main.js scripts/main.js.map
git commit -m "chore: v1.5.0-rc2 version and live checklist for resize and leftover sweep"
```
