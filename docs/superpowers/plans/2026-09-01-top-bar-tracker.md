# Top-Bar Tracker (B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An always-on horizontal combat tracker (portrait strip) across the top of the screen, rendering every combatant in initiative order (visibility-respecting) with GM turn controls, coexisting with the core sidebar tracker.

**Architecture:** A custom DOM overlay driven by combat hooks. All decision logic lives in one pure, TDD'd view-model function (`buildTrackerView`); a defensive-DOM adapter reads the Foundry `Combat` document into a plain input, calls the view model, and paints rows. It is a view over Foundry's combat - turns/rounds/initiative stay native.

**Tech Stack:** TypeScript (strictest), vitest, esbuild, Foundry v14 + dnd5e 5.3.

**Spec:** `docs/superpowers/specs/2026-09-01-top-bar-tracker-design.md`

## Global Constraints

- Foundry **v14** + **dnd5e 5.3+** only.
- Strict TDD (superpowers:test-driven-development): no production logic without a failing test first. Foundry-coupled code goes behind the pure `buildTrackerView` seam; only irreducible Foundry calls are untested (manual checklist).
- All mutation (turn control) runs on the elected active GM (`isActiveGM`), guard-wrapped; turn controls are not rendered for non-GMs.
- Full JSDoc on every export; ASCII-only; no placeholders.
- Commits require the user's per-commit approval; this project authorizes a `Co-Authored-By` trailer (no emoji), no `Claude-Session` trailer.
- Lands on `feat/automation-rules-f4-f5` (PR #1) per the maintainer decision.

**Plan refinements over the spec (intentional):**
- Group rows carry their own `name`/`color`; group metadata travels in `TrackerInput.groups` (the pure function takes no Foundry globals). Combatant rows are always ungrouped (grouped members collapse into a group row), so they carry no `groupColor`.
- Row collapse uses a single in-order walk (not `partitionByGroup`, which separates rather than interleaves), so group and ungrouped rows keep Foundry turn order.
- The bar's **right-click context menu reuses the sidebar builders** (`pushTagOptions` / `pushGroupOptions`) via a small self-rendered menu (Task 4), rather than Foundry's `ContextMenu` API, to avoid a v14 API guess.

---

### Task 1: `buildTrackerView` view model (pure, TDD)

**Files:**
- Create: `src/logic/tracker-view.ts`
- Test: `test/tracker-view.test.ts`

**Interfaces:**
- Consumes: `Tag` from `src/constants.ts`.
- Produces: `TrackerHp`, `TrackerCombatant`, `TrackerGroup`, `TrackerInput`, `Viewer`, `TrackerRow`, and `buildTrackerView(input: TrackerInput, viewer: Viewer): TrackerRow[]`.

- [ ] **Step 1: Write the failing test**

Create `test/tracker-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTrackerView, type TrackerCombatant, type TrackerInput, type Viewer } from "../src/logic/tracker-view";

function c(over: Partial<TrackerCombatant> & { id: string }): TrackerCombatant {
  return {
    id: over.id,
    name: over.name ?? over.id,
    img: over.img ?? `${over.id}.png`,
    initiative: over.initiative ?? 10,
    tag: over.tag ?? "mob",
    groupId: over.groupId ?? null,
    hidden: over.hidden ?? false,
    isDefeated: over.isDefeated ?? false,
    ownedByViewer: over.ownedByViewer ?? false,
    hp: over.hp ?? { value: 7, max: 10 },
    conditions: over.conditions ?? []
  };
}

const GM: Viewer = { isGM: true, playerHpPolicy: "bar" };
const PLAYER: Viewer = { isGM: false, playerHpPolicy: "bar" };

function input(combatants: TrackerCombatant[], currentId: string | null = null): TrackerInput {
  return { combatants, groups: [{ id: "g", name: "Goblins", color: "#00ff00" }], currentId };
}

describe("buildTrackerView", () => {
  it("keeps turn order and marks the current combatant", () => {
    const rows = buildTrackerView(input([c({ id: "a" }), c({ id: "b" })], "b"), GM);
    expect(rows.map((r) => r.kind === "combatant" && r.combatantId)).toEqual(["a", "b"]);
    expect(rows[1]).toMatchObject({ isCurrent: true });
    expect(rows[0]).toMatchObject({ isCurrent: false });
  });

  it("hides unowned hidden combatants from a player but not the GM", () => {
    const combatants = [c({ id: "a" }), c({ id: "secret", hidden: true })];
    expect(buildTrackerView(input(combatants), PLAYER)).toHaveLength(1);
    expect(buildTrackerView(input(combatants), GM)).toHaveLength(2);
  });

  it("shows a hidden combatant the player owns", () => {
    const rows = buildTrackerView(input([c({ id: "mine", hidden: true, ownedByViewer: true })]), PLAYER);
    expect(rows).toHaveLength(1);
  });

  it("applies HP policy: full for GM/owner, bar or none otherwise", () => {
    const target = c({ id: "x", hp: { value: 3, max: 9 } });
    const gmRow = buildTrackerView(input([target]), GM)[0];
    const barRow = buildTrackerView(input([target]), PLAYER)[0];
    const noneRow = buildTrackerView(input([target]), { isGM: false, playerHpPolicy: "none" })[0];
    expect(gmRow).toMatchObject({ hp: { value: 3, max: 9, shown: "full" } });
    expect(barRow).toMatchObject({ hp: { value: 3, max: 9, shown: "bar" } });
    expect(noneRow).toMatchObject({ hp: { value: null, max: null, shown: "none" } });
  });

  it("collapses a group into one row at its first-seen position, current if any member is", () => {
    const rows = buildTrackerView(
      input([c({ id: "solo" }), c({ id: "m1", groupId: "g" }), c({ id: "m2", groupId: "g" })], "m2"),
      GM
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "combatant", combatantId: "solo" });
    expect(rows[1]).toMatchObject({ kind: "group", groupId: "g", name: "Goblins", color: "#00ff00", memberCount: 2, isCurrent: true });
  });

  it("counts only visible members in a collapsed group", () => {
    const rows = buildTrackerView(
      input([c({ id: "m1", groupId: "g" }), c({ id: "m2", groupId: "g", hidden: true })]),
      PLAYER
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "group", memberCount: 1 });
  });

  it("carries tag and defeated on a combatant row", () => {
    const rows = buildTrackerView(input([c({ id: "b", tag: "boss", isDefeated: true })]), GM);
    expect(rows[0]).toMatchObject({ kind: "combatant", tag: "boss", isDefeated: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tracker-view.test.ts`
Expected: FAIL (`Cannot find module '../src/logic/tracker-view'`).

- [ ] **Step 3: Write the minimal implementation**

Create `src/logic/tracker-view.ts`:

```ts
/**
 * @file Pure combat-tracker view model: turn order + per-viewer visibility and
 * HP filtering + group collapse, with no Foundry globals or side effects. The
 * top-bar adapter reads Foundry docs into a TrackerInput, calls this, and paints
 * the rows.
 */

import type { Tag } from "../constants";

/** How a combatant's HP is shown to a given viewer. */
export interface TrackerHp {
  /** Current HP, or null when not shown. */
  value: number | null;
  /** Max HP, or null when not shown. */
  max: number | null;
  /** Render mode: numbers, a ratio bar only, or nothing. */
  shown: "full" | "bar" | "none";
}

/** A combatant reduced to what the view model needs (no Foundry types). */
export interface TrackerCombatant {
  id: string;
  name: string;
  img: string | null;
  initiative: number | null;
  tag: Tag | null;
  groupId: string | null;
  hidden: boolean;
  isDefeated: boolean;
  ownedByViewer: boolean;
  hp: { value: number | null; max: number | null };
  conditions: readonly string[];
}

/** Group metadata (name + tag color) for collapsed group rows. */
export interface TrackerGroup {
  id: string;
  name: string;
  color: string;
}

/** The full input to {@link buildTrackerView}. */
export interface TrackerInput {
  /** Combatants in Foundry turn order. */
  combatants: readonly TrackerCombatant[];
  /** Group metadata by id. */
  groups: readonly TrackerGroup[];
  /** The current combatant id, or null. */
  currentId: string | null;
}

/** The viewer the bar is rendered for. */
export interface Viewer {
  isGM: boolean;
  /** How non-owned combatants' HP is shown to this (non-GM) viewer. */
  playerHpPolicy: "bar" | "none";
}

/** One rendered row: a single combatant, or a collapsed group. */
export type TrackerRow =
  | {
      kind: "combatant";
      combatantId: string;
      name: string;
      img: string | null;
      initiative: number | null;
      tag: Tag | null;
      hp: TrackerHp;
      conditions: readonly string[];
      isCurrent: boolean;
      isDefeated: boolean;
    }
  | {
      kind: "group";
      groupId: string;
      name: string;
      color: string;
      memberCount: number;
      initiative: number | null;
      img: string | null;
      isCurrent: boolean;
    };

/** Default group color when metadata is missing. */
const DEFAULT_GROUP_COLOR = "#8888ff";

/** Whether a combatant is visible to the viewer. */
function isVisible(combatant: TrackerCombatant, viewer: Viewer): boolean {
  return viewer.isGM || !combatant.hidden || combatant.ownedByViewer;
}

/** The HP view for a combatant and viewer, per ownership and policy. */
function hpFor(combatant: TrackerCombatant, viewer: Viewer): TrackerHp {
  if (viewer.isGM || combatant.ownedByViewer) {
    return { value: combatant.hp.value, max: combatant.hp.max, shown: "full" };
  }
  if (viewer.playerHpPolicy === "bar") {
    return { value: combatant.hp.value, max: combatant.hp.max, shown: "bar" };
  }
  return { value: null, max: null, shown: "none" };
}

/**
 * Build the ordered tracker rows for one viewer: filters invisible combatants,
 * applies the HP policy, and collapses each group into a single row at its
 * first visible member's position, preserving turn order.
 *
 * @param input - Combatants (in turn order), group metadata, current id.
 * @param viewer - The viewer to render for.
 * @returns The rows to paint, in order.
 */
export function buildTrackerView(input: TrackerInput, viewer: Viewer): TrackerRow[] {
  const meta = new Map(input.groups.map((group) => [group.id, group]));
  const rows: TrackerRow[] = [];
  const seenGroups = new Set<string>();
  for (const combatant of input.combatants) {
    if (!isVisible(combatant, viewer)) continue;
    if (combatant.groupId !== null) {
      if (seenGroups.has(combatant.groupId)) continue;
      seenGroups.add(combatant.groupId);
      const members = input.combatants.filter(
        (other) => other.groupId === combatant.groupId && isVisible(other, viewer)
      );
      const group = meta.get(combatant.groupId);
      rows.push({
        kind: "group",
        groupId: combatant.groupId,
        name: group?.name ?? "",
        color: group?.color ?? DEFAULT_GROUP_COLOR,
        memberCount: members.length,
        initiative: combatant.initiative,
        img: members[0]?.img ?? null,
        isCurrent: members.some((member) => member.id === input.currentId)
      });
    } else {
      rows.push({
        kind: "combatant",
        combatantId: combatant.id,
        name: combatant.name,
        img: combatant.img,
        initiative: combatant.initiative,
        tag: combatant.tag,
        hp: hpFor(combatant, viewer),
        conditions: combatant.conditions,
        isCurrent: combatant.id === input.currentId,
        isDefeated: combatant.isDefeated
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tracker-view.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Full check**

Run: `npm run check`
Expected: PASS (typecheck + all tests + build).

- [ ] **Step 6: Commit**

```bash
git add src/logic/tracker-view.ts test/tracker-view.test.ts
git commit -m "feat: pure top-bar tracker view model (buildTrackerView)"
```

---

### Task 2: Top-bar adapter - render + subscriptions + settings

**Files:**
- Modify: `src/constants.ts` (two setting keys)
- Modify: `src/settings.ts` (register the two settings)
- Modify: `src/foundry-env.d.ts` (ambient: combatant `name`/`img`/`hidden`, combat `combatant`/`round`/turn-nav, actor `statuses`, `canvas.pan`, token `center`)
- Create: `src/adapter/top-bar.ts`
- Modify: `src/main.ts` (register at init)

**Interfaces:**
- Consumes: `buildTrackerView` + its types (Task 1); `groupColor` from `src/adapter/groups.ts`; `readCombatantTag` from `src/adapter/tags.ts`; `isActiveGM` from `src/adapter/hooks.ts`.
- Produces: `registerTopBar(): void`; `SETTINGS.ENABLE_TOP_BAR`, `SETTINGS.PLAYER_HP_POLICY`. Foundry boundary; no unit tests.

- [ ] **Step 1: Add setting keys**

In `src/constants.ts`, inside the `SETTINGS` object, add:

```ts
  /** World setting: whether the top-bar tracker is shown. */
  ENABLE_TOP_BAR: "enableTopBar",
  /** World setting: how non-owned HP is shown to players ("bar" | "none"). */
  PLAYER_HP_POLICY: "playerHpPolicy",
```

- [ ] **Step 2: Register the settings**

In `src/settings.ts` `registerSettings`, following the existing `PLAYER_TIMEOUT` registration pattern, add:

```ts
  game.settings.register(MODULE_ID, SETTINGS.ENABLE_TOP_BAR, {
    name: "TACTICAL_INITIATIVE.Settings.EnableTopBar.Name",
    hint: "TACTICAL_INITIATIVE.Settings.EnableTopBar.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.PLAYER_HP_POLICY, {
    name: "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Name",
    hint: "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: { bar: "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Bar", none: "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.None" },
    default: "bar"
  });
```

(Match the exact import/registration style already in `settings.ts`; `MODULE_ID` and `SETTINGS` are imported there.)

- [ ] **Step 3: Extend ambient types**

In `src/foundry-env.d.ts`:

Add to `interface FoundryCombatant` (after `group`):

```ts
  /** The token/combatant display name. */
  readonly name: string;
  /** The combatant portrait image path. */
  readonly img?: string | null;
  /** True when the GM has hidden this combatant from players. */
  readonly hidden: boolean;
```

Add to `interface FoundryActor` (after `system`):

```ts
  /** Active status/condition ids on this actor (core v11+/dnd5e). */
  readonly statuses?: ReadonlySet<string>;
```

Add to `interface FoundryCombat` (after `groups`):

```ts
  /** The current round number. */
  readonly round: number;
  /** The combatant whose turn it is, or null. */
  readonly combatant: FoundryCombatant | null;
  previousTurn(): Promise<unknown>;
  nextTurn(): Promise<unknown>;
  nextRound(): Promise<unknown>;
  endCombat(): Promise<unknown>;
```

Extend the `canvas` global and `TokenObject`:

```ts
declare const canvas: {
  tokens?: { get(id: string): TokenObject | undefined } | null;
  pan?(options: { x?: number; y?: number; scale?: number }): void;
};
```

Add to `interface TokenObject`:

```ts
  /** The token's canvas center, for panning. */
  readonly center?: { x: number; y: number };
```

- [ ] **Step 4: Write the adapter**

Create `src/adapter/top-bar.ts`:

```ts
/**
 * @file The top-bar combat tracker: a full-width DOM overlay under #ui-top that
 * renders the active combat as a portrait strip via the pure buildTrackerView.
 * Re-renders on combat changes; each client renders its own bar for its own
 * user. Foundry boundary: not unit-tested (buildTrackerView is).
 */

import { MODULE_ID, SETTINGS } from "../constants";
import {
  buildTrackerView,
  type TrackerCombatant,
  type TrackerInput,
  type TrackerRow,
  type Viewer
} from "../logic/tracker-view";
import { groupColor } from "./groups";
import { readCombatantTag } from "./tags";

/** The id of the bar container element. */
const CONTAINER_ID = `${MODULE_ID}-top-bar`;

/** Whether the bar is enabled by setting. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.ENABLE_TOP_BAR) === true;
}

/** The current viewer descriptor. */
function viewer(): Viewer {
  const policy = game.settings.get(MODULE_ID, SETTINGS.PLAYER_HP_POLICY);
  return {
    isGM: game.user?.isGM === true,
    playerHpPolicy: policy === "none" ? "none" : "bar"
  };
}

/** Map one Foundry combatant to a plain TrackerCombatant. */
function toCombatant(combatant: FoundryCombatant): TrackerCombatant {
  const actor = combatant.actor;
  const hp = actor?.system?.attributes?.hp;
  const owned = actor && game.user ? actor.testUserPermission(game.user, "OWNER") : false;
  return {
    id: combatant.id,
    name: combatant.name,
    img: combatant.img ?? null,
    initiative: combatant.initiative,
    tag: readCombatantTag(combatant),
    groupId: typeof combatant.group === "string" && combatant.group ? combatant.group : null,
    hidden: combatant.hidden,
    isDefeated: combatant.isDefeated,
    ownedByViewer: owned,
    hp: { value: typeof hp?.value === "number" ? hp.value : null, max: typeof hp?.max === "number" ? hp.max : null },
    conditions: actor?.statuses ? [...actor.statuses] : []
  };
}

/** Read the active combat into a TrackerInput. */
function toInput(combat: FoundryCombat): TrackerInput {
  return {
    combatants: combat.turns.map(toCombatant),
    groups: combat.groups.contents.map((group) => ({ id: group.id, name: group.name, color: groupColor(group) })),
    currentId: combat.combatant?.id ?? null
  };
}

/** Get or create the bar container under #ui-top (falling back to body). */
function container(): HTMLElement {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) return existing;
  const element = document.createElement("div");
  element.id = CONTAINER_ID;
  element.className = `${MODULE_ID}-top-bar`;
  (document.getElementById("ui-top") ?? document.body).appendChild(element);
  return element;
}

/** Build one combatant or group row element (interactions added in Task 3). */
function renderRow(row: TrackerRow): HTMLElement {
  const li = document.createElement("div");
  li.className = `${MODULE_ID}-tb-row ${MODULE_ID}-tb-${row.kind}`;
  if (row.isCurrent) li.classList.add(`${MODULE_ID}-tb-current`);
  if (row.kind === "combatant") {
    li.dataset["combatantId"] = row.combatantId;
    if (row.isDefeated) li.classList.add(`${MODULE_ID}-tb-defeated`);
    if (row.img) li.style.backgroundImage = `url("${row.img}")`;
    if (row.hp.shown !== "none" && row.hp.value !== null && row.hp.max !== null && row.hp.max > 0) {
      const bar = document.createElement("div");
      bar.className = `${MODULE_ID}-tb-hp`;
      bar.style.width = `${Math.max(0, Math.min(100, (row.hp.value / row.hp.max) * 100))}%`;
      li.appendChild(bar);
      if (row.hp.shown === "full") {
        const text = document.createElement("span");
        text.className = `${MODULE_ID}-tb-hp-text`;
        text.textContent = `${row.hp.value}/${row.hp.max}`;
        li.appendChild(text);
      }
    }
    if (row.conditions.length > 0) {
      const cond = document.createElement("span");
      cond.className = `${MODULE_ID}-tb-cond`;
      cond.textContent = String(row.conditions.length);
      cond.title = row.conditions.join(", ");
      li.appendChild(cond);
    }
    li.title = row.name;
  } else {
    li.dataset["groupId"] = row.groupId;
    li.style.borderColor = row.color;
    if (row.img) li.style.backgroundImage = `url("${row.img}")`;
    const badge = document.createElement("span");
    badge.className = `${MODULE_ID}-tb-count`;
    badge.textContent = `x${row.memberCount}`;
    li.appendChild(badge);
    li.title = row.name;
  }
  return li;
}

/** Render (or hide) the bar for the active combat. */
function render(): void {
  try {
    const element = container();
    const combat = game.combats?.active ?? null;
    if (!combat || !enabled()) {
      element.hidden = true;
      element.replaceChildren();
      return;
    }
    const rows = buildTrackerView(toInput(combat), viewer());
    element.replaceChildren(...rows.map(renderRow));
    element.hidden = false;
  } catch (error) {
    console.error(`${MODULE_ID} | top-bar render`, error);
  }
}

/**
 * Register the top-bar tracker: create the container and re-render it on every
 * combat change. Interactions and turn controls are added by the same module in
 * Task 3.
 */
export function registerTopBar(): void {
  Hooks.once("ready", render);
  for (const hook of ["updateCombat", "updateCombatant", "createCombatant", "deleteCombatant", "deleteCombat"]) {
    Hooks.on(hook, () => {
      render();
    });
  }
}
```

- [ ] **Step 5: Register at init**

In `src/main.ts`, import and call in the `init` hook (after `registerGroupUI()`):

```ts
import { registerTopBar } from "./adapter/top-bar";
```
```ts
  registerTopBar();
```

- [ ] **Step 6: Verify build**

Run: `npm run check`
Expected: PASS (typecheck + tests + build; adapter untested).

- [ ] **Step 7: Commit**

```bash
git add src/constants.ts src/settings.ts src/foundry-env.d.ts src/adapter/top-bar.ts src/main.ts
git commit -m "feat: top-bar tracker adapter - render active combat as a portrait strip"
```

---

### Task 3: Interactions + GM turn controls

**Files:**
- Modify: `src/adapter/top-bar.ts`

**Interfaces:**
- Consumes: `openGroupHud` from `src/adapter/group-hud.ts`; `isActiveGM` from `src/adapter/hooks.ts`; `findCombatant` from `src/adapter/lookup.ts`.
- Produces: click/double-click/group-click handlers on rows; a GM turn-control cluster. Foundry boundary; manual checklist.

- [ ] **Step 1: Add interaction wiring to rows**

In `src/adapter/top-bar.ts`, add imports:

```ts
import { openGroupHud } from "./group-hud";
import { isActiveGM } from "./hooks";
import { findCombatant } from "./lookup";
```

Add these helpers:

```ts
/** Pan to and control a combatant's token (GM or owner). */
function focusToken(combatantId: string): void {
  const location = findCombatant(combatantId);
  const tokenId = location?.combatant.tokenId ?? null;
  if (!tokenId) return;
  const token = canvas.tokens?.get(tokenId);
  token?.control({ releaseOthers: true });
  if (token?.center) canvas.pan?.({ x: token.center.x, y: token.center.y });
}

/** Open the actor sheet for a combatant. */
function openSheet(combatantId: string): void {
  findCombatant(combatantId)?.combatant.actor?.sheet?.render(true);
}
```

Note: add `readonly sheet?: { render(force: boolean): unknown };` to `FoundryActor` in `src/foundry-env.d.ts` in this step (used by `openSheet`).

- [ ] **Step 2: Attach listeners in `renderRow`**

In `renderRow`, before `return li;`, for a combatant row add:

```ts
    li.addEventListener("click", () => {
      focusToken(row.combatantId);
    });
    li.addEventListener("dblclick", () => {
      openSheet(row.combatantId);
    });
```

For a group row add:

```ts
    li.addEventListener("click", () => {
      const combat = game.combats?.active ?? null;
      if (combat) openGroupHud(combat, row.groupId);
    });
```

- [ ] **Step 3: Add the GM turn-control cluster**

In `src/adapter/top-bar.ts`, add:

```ts
/** Build the GM turn-control cluster (previous/next turn, next round, end, round no.). */
function renderControls(combat: FoundryCombat): HTMLElement {
  const bar = document.createElement("div");
  bar.className = `${MODULE_ID}-tb-controls`;
  const round = document.createElement("span");
  round.className = `${MODULE_ID}-tb-round`;
  round.textContent = game.i18n.format("TACTICAL_INITIATIVE.Tracker.Round", { n: String(combat.round) });
  bar.appendChild(round);
  const button = (action: string, icon: string, key: string, run: () => Promise<unknown>): void => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `${MODULE_ID}-tb-btn`;
    el.dataset["tbAction"] = action;
    el.innerHTML = `<i class="fas ${icon}"></i>`;
    el.title = game.i18n.localize(key);
    el.addEventListener("click", () => {
      if (isActiveGM()) void run();
    });
    bar.appendChild(el);
  };
  button("prev", "fa-backward-step", "TACTICAL_INITIATIVE.Tracker.PrevTurn", () => combat.previousTurn());
  button("next", "fa-forward-step", "TACTICAL_INITIATIVE.Tracker.NextTurn", () => combat.nextTurn());
  button("round", "fa-forward", "TACTICAL_INITIATIVE.Tracker.NextRound", () => combat.nextRound());
  button("end", "fa-flag-checkered", "TACTICAL_INITIATIVE.Tracker.EndCombat", () => combat.endCombat());
  return bar;
}
```

- [ ] **Step 4: Append controls in `render` for the GM**

In `render`, after `element.replaceChildren(...rows.map(renderRow));` add:

```ts
    if (game.user?.isGM === true) element.appendChild(renderControls(combat));
```

- [ ] **Step 5: Verify build**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/adapter/top-bar.ts src/foundry-env.d.ts
git commit -m "feat: top-bar interactions (focus/sheet/group HUD) and GM turn controls"
```

---

### Task 4: Right-click context menu (reuse the sidebar tag/group menus)

**Files:**
- Modify: `src/adapter/tagging-ui.ts` (export `pushTagOptions`)
- Modify: `src/adapter/group-ui.ts` (export `pushGroupOptions`)
- Modify: `src/adapter/top-bar.ts` (right-click handler + a self-rendered menu)

**Interfaces:**
- Consumes: `pushTagOptions` (tagging-ui), `pushGroupOptions` (group-ui). Both push entries of shape `{ name; icon; condition: (target?) => boolean; callback: (target) => void }` and resolve the combatant/group from a DOM element carrying `data-combatant-id`.
- Produces: a right-click context menu on combatant rows. Foundry boundary; manual checklist.

- [ ] **Step 1: Export the entry builders**

In `src/adapter/tagging-ui.ts`, change `function pushTagOptions` to `export function pushTagOptions`.
In `src/adapter/group-ui.ts`, change `function pushGroupOptions` to `export function pushGroupOptions`.

(Their entry type is structural; adding `export` is the only change. A `(target?) => boolean` condition is assignable to tagging-ui's `() => boolean`, so a shared `MenuEntry[]` type works for both.)

- [ ] **Step 2: Add the menu to `top-bar.ts`**

Add imports:

```ts
import { pushGroupOptions } from "./group-ui";
import { pushTagOptions } from "./tagging-ui";
```

Add the shared entry type and the menu renderer:

```ts
/** A context-menu entry shape shared with the tag/group builders. */
interface MenuEntry {
  name: string;
  icon: string;
  condition: (target?: unknown) => boolean;
  callback: (target: unknown) => void;
}

/** Remove any open bar context menu. */
function closeMenu(): void {
  document.getElementById(`${MODULE_ID}-tb-menu`)?.remove();
}

/** Open a context menu at (x, y) for the given row element. */
function openMenu(rowEl: HTMLElement, x: number, y: number): void {
  closeMenu();
  const entries: MenuEntry[] = [];
  pushTagOptions(entries);
  pushGroupOptions(entries);
  const visible = entries.filter((entry) => {
    try {
      return entry.condition(rowEl);
    } catch {
      return false;
    }
  });
  if (visible.length === 0) return;
  const menu = document.createElement("nav");
  menu.id = `${MODULE_ID}-tb-menu`;
  menu.className = `${MODULE_ID}-tb-menu`;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const entry of visible) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `${MODULE_ID}-tb-menu-item`;
    item.innerHTML = `${entry.icon} <span>${entry.name}</span>`;
    item.addEventListener("click", () => {
      closeMenu();
      try {
        entry.callback(rowEl);
      } catch (error) {
        console.error(`${MODULE_ID} | top-bar menu`, error);
      }
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  window.addEventListener("pointerdown", closeMenu, { once: true });
}
```

- [ ] **Step 3: Wire contextmenu on combatant rows**

In `renderRow`, in the combatant branch (alongside the click/dblclick listeners from Task 3), add:

```ts
    li.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu(li, event.clientX, event.clientY);
    });
```

- [ ] **Step 4: Verify build**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapter/tagging-ui.ts src/adapter/group-ui.ts src/adapter/top-bar.ts
git commit -m "feat: right-click tag/group context menu on top-bar rows"
```

---

### Task 5: Styles + i18n + version + README checklist

**Files:**
- Modify: `styles/tactical-initiative.css`
- Modify: `lang/en.json`
- Modify: `module.json`, `package.json` (version bump to `1.5.0`)
- Modify: `README.md`

- [ ] **Step 1: Styles**

Append to `styles/tactical-initiative.css`:

```css
/* Top-bar combat tracker (B2). */
.tactical-initiative-top-bar {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 0.25em;
  padding: 0.2em 0.4em;
  margin: 0 auto;
  max-width: 90vw;
  overflow-x: auto;
  pointer-events: all;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 0 0 0.4em 0.4em;
}

.tactical-initiative-tb-row {
  position: relative;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-radius: 4px;
  background-size: cover;
  background-position: center;
  cursor: pointer;
}

.tactical-initiative-tb-current {
  outline: 2px solid var(--color-warning, #d9a520);
  transform: translateY(-3px) scale(1.08);
}

.tactical-initiative-tb-defeated {
  filter: grayscale(1) brightness(0.6);
}

.tactical-initiative-tb-hp {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 4px;
  background: #c0392b;
}

.tactical-initiative-tb-hp-text {
  position: absolute;
  bottom: 4px;
  width: 100%;
  text-align: center;
  font-size: 9px;
  color: #fff;
  text-shadow: 0 0 2px #000;
}

.tactical-initiative-tb-count {
  position: absolute;
  top: -6px;
  right: -6px;
  padding: 0 3px;
  border-radius: 6px;
  background: #222;
  color: #fff;
  font-size: 9px;
}

.tactical-initiative-tb-cond {
  position: absolute;
  top: -6px;
  left: -6px;
  padding: 0 3px;
  border-radius: 6px;
  background: #6a1b9a;
  color: #fff;
  font-size: 9px;
}

.tactical-initiative-tb-controls {
  display: flex;
  align-items: center;
  gap: 0.2em;
  margin-left: 0.5em;
}

.tactical-initiative-tb-round {
  color: #fff;
  font-size: 11px;
  margin-right: 0.3em;
}

.tactical-initiative-tb-menu {
  position: fixed;
  z-index: 100;
  min-width: 160px;
  padding: 0.2em;
  background: #1b1b1b;
  border: 1px solid #666;
  border-radius: 4px;
}

.tactical-initiative-tb-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.2em 0.4em;
  background: transparent;
  border: none;
  color: #eee;
  cursor: pointer;
}

.tactical-initiative-tb-menu-item:hover {
  background: rgba(255, 255, 255, 0.12);
}
```

- [ ] **Step 2: i18n keys**

Add to `lang/en.json`:

```json
  "TACTICAL_INITIATIVE.Tracker.PrevTurn": "Previous turn",
  "TACTICAL_INITIATIVE.Tracker.NextTurn": "Next turn",
  "TACTICAL_INITIATIVE.Tracker.NextRound": "Next round",
  "TACTICAL_INITIATIVE.Tracker.EndCombat": "End combat",
  "TACTICAL_INITIATIVE.Tracker.Round": "Round {n}",
  "TACTICAL_INITIATIVE.Settings.EnableTopBar.Name": "Show the top-bar tracker",
  "TACTICAL_INITIATIVE.Settings.EnableTopBar.Hint": "Render an always-on horizontal combat tracker across the top of the screen.",
  "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Name": "Player HP display",
  "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Hint": "How much HP players see for combatants they do not own in the top-bar tracker.",
  "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Bar": "Ratio bar only",
  "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.None": "Hidden",
```

(Insert with a trailing comma after the existing `HUD.*` block; keep the file valid JSON.)

- [ ] **Step 3: Version bump**

Set `module.json` and `package.json` `version` to `1.5.0`.

- [ ] **Step 4: README checklist**

Add a section to `README.md` before `## Development`:

```markdown
## Top-bar tracker checklist (B2, v1.5.0)

v14 + dnd5e 5.3 only. The bar is the Foundry boundary (untested); its hooks and DOM anchor
are assumptions to confirm live.

1. **Appears / hides.** Start combat -> a horizontal portrait strip appears at the top; end
   combat -> it disappears. Toggling the "Show the top-bar tracker" setting hides/shows it.
2. **Order + current turn.** Portrait order matches the sidebar tracker; the current
   combatant is enlarged/highlighted and follows next/previous turn.
3. **Visibility.** As a player, GM-hidden combatants you do not own are absent; the GM sees
   all. HP shows as a bar (or hidden) for un-owned combatants per the "Player HP display"
   setting; full numbers for the GM and owners.
4. **Groups.** A group renders as one cell with its color, `xN` count, and shared initiative;
   clicking it opens the group HUD.
5. **Interactions.** Click a portrait pans to and selects its token; double-click opens the
   sheet.
6. **GM turn controls.** The controls (previous/next turn, next round, end combat, round
   number) appear only for the GM and drive the native combat.
7. **Right-click menu.** Right-click a combatant row -> the same tag/group menu the sidebar
   shows (tag as..., add to group, rename/recolor/disband, etc.).

If the bar never appears, check the DOM anchor (`#ui-top`) and the hook names in a v14 build.
```

- [ ] **Step 5: Verify + commit (with bundle)**

Run: `npm run check`

```bash
git add styles/tactical-initiative.css lang/en.json module.json package.json README.md scripts/main.js scripts/main.js.map
git commit -m "chore: top-bar tracker styles, i18n, v1.5.0, and manual checklist"
```

---

## Live-world verification

1. The bar appears at combat start under the top UI, movable content scrolls horizontally, and hides at combat end.
2. Turn order and the current-turn highlight match the sidebar and follow next/previous turn and next round.
3. A player sees only visible combatants and the configured HP amount; the GM sees everything.
4. A group shows one cell (color + count + shared initiative) and opens the HUD on click; click a combatant to pan/select, double-click to open its sheet.
5. GM turn controls advance the native combat; players do not see them.
