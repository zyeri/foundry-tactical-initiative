# Map Grouping - Plan A (Fixes + Map Grouping) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grouping work from the battlemap (Token HUD button + `G` key), give each group one turn and one stacked-portrait cell on the top bar, and fix the dead top-bar menu and null group reads.

**Architecture:** Pure helpers (`src/logic/group.ts`, `src/logic/turns.ts`, `src/logic/tracker-view.ts`) and a port-driven `GroupingService` (`src/grouping-service.ts`) carry all decisions and are unit-tested. DOM wiring that caused the shipped dead-menu bug moves to `src/ui/menu.ts` (no Foundry globals) and is tested under happy-dom. Foundry adapters (`src/adapter/*`) stay thin and are covered by the README manual checklist.

**Tech Stack:** TypeScript (strict), vitest 2 (node env; happy-dom env per-file for `src/ui`), esbuild, Foundry v14 + dnd5e 5.3.

**Spec:** `docs/superpowers/specs/2026-09-22-map-grouping-design.md` (rev 2). Plan B (resize + leftover sweep) follows in `2026-09-22-map-grouping-b.md`.

## Global Constraints

- Foundry **v14** + **dnd5e 5.3+** only.
- Strict TDD for everything in `src/logic`, `src/grouping-service.ts`, `src/ui`: failing test first. Only raw Foundry calls in `src/adapter` are untested (README checklist).
- Full JSDoc on every exported symbol, matching existing files. ASCII only, no emoji.
- Every async UI callback goes through `runSafe` (Task 5) or the existing `guard` (hook bodies). No bare `void promise`.
- Hook-driven automation stays active-GM-only (`isActiveGM()`); user-initiated grouping runs on the invoking GM (`game.user.isGM`).
- Branch `feat/map-grouping`, worktree `C:/Users/zyery/projects/tactical-initiative-wt-map-grouping`. Run all commands from that worktree.
- `npm run check` (typecheck + tests + build) passes at the end of every task; commit the rebuilt `scripts/main.js` with each task.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (project-authorized trailer, no emoji). Commits require the user's per-commit approval.
- No version bump in Plan A (v1.5.0-rc2 bump happens at the end of Plan B).

## Review Focus

- A boss token selected for grouping: its `end` slot shares the `tokenId` and must never be assigned or counted as a second selection (Task 4 test "ignores boss end slots").
- The Token HUD's own token is also controlled: the token set must deduplicate, not create two combatants (Task 4 test "deduplicates token ids").
- Dismissing the group dialog must leave the world untouched: no group created, no combatant created (Task 4 test "dismiss writes nothing").
- Next Turn from the last group of a round must advance the round, not stall on the group (Task 2 test "forward skip past the end asks for next round").
- Pressing a top-bar menu item must fire it (the shipped bug) (Task 5 test "pointerdown then click on an item runs it").

---

### Task 0: Live probe (manual, the DM runs this)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-map-grouping-design.md` (append a "P0 probe results" section)

- [ ] **Step 1: In a v14 + dnd5e 5.3 world with v1.5.0 installed, group two combatants with the old sidebar menu, then run in the F12 console:**

```js
const c = game.combat.combatants.contents.find(x => x._source.group);
console.log(typeof c.group, c.group?.id ?? c.group, c._source.group);
console.log(typeof CONFIG.Combat.documentClass.prototype._sortCombatants);
console.log([...game.keybindings.bindings.entries()].filter(([, bs]) => bs.some((b) => b.key === "KeyG")).map(([action]) => action));
```

Expected: first line prints `object <id> <id>` (confirms root cause 2), second prints `function`, third lists any action already bound to `KeyG`.

- [ ] **Step 2: Reproduce the token-delete leftover.** Start a combat with one plain token on the viewed scene, delete the token as GM (Delete key, confirm core's dialog). Note whether the combatant remains in (a) the sidebar, (b) the top bar.

- [ ] **Step 3: Append results to the spec** under a new `## P0 probe results (<date>)` heading and commit:

```bash
git add docs/superpowers/specs/2026-09-22-map-grouping-design.md
git commit -m "docs: record P0 live probe results"
```

If `_sortCombatants` is not a function, Task 7 Step 5 logs a one-time warning and contiguity relies on dnd5e's decimal tiebreaker; note that in the results.

---

### Task 1: Pure group helpers + `groupIdOf` read-site refactor

**Files:**
- Modify: `src/logic/group.ts`
- Modify: `test/group.test.ts`
- Modify: `src/foundry-env.d.ts:101-102` (Combatant `group`, add `_source`)
- Modify: `src/adapter/top-bar.ts:52`, `src/adapter/foundry-adapter.ts:69,154`, `src/adapter/group-control.ts:26`, `src/adapter/groups.ts:63,72,108`, `src/adapter/group-ui.ts:98,388`, `src/adapter/hooks.ts:111`, `src/adapter/boss-slots.ts:75`

**Interfaces:**
- Produces (all exported from `src/logic/group.ts`):
  - `interface GroupCarrier { _source?: { group?: string | null } | null; group?: string | { id: string } | null }`
  - `groupIdOf(c: GroupCarrier): string | null`
  - `interface GroupRef { id: string; name: string; color: string | null }`
  - `interface SelRef { combatantId: string | null; groupId: string | null }`
  - `type GroupChoice = { kind: "none" } | { kind: "create" } | { kind: "prompt"; options: GroupRef[]; offerRemove: boolean }`
  - `resolveGroupChoice(selected: readonly SelRef[], groups: readonly GroupRef[]): GroupChoice`
  - `majorityName(names: readonly string[]): string | null`
  - `nextGroupName(existing: readonly string[], base: string): string`

- [ ] **Step 1: Write the failing tests.** Append to `test/group.test.ts` (keep the existing `partitionByGroup` tests; extend the import line):

```ts
import {
  groupIdOf,
  majorityName,
  nextGroupName,
  partitionByGroup,
  resolveGroupChoice,
  type GroupRef
} from "../src/logic/group";

describe("groupIdOf", () => {
  it("prefers the raw _source id", () => {
    expect(groupIdOf({ _source: { group: "g1" }, group: { id: "other" } })).toBe("g1");
  });
  it("reads a string group field", () => {
    expect(groupIdOf({ group: "g2" })).toBe("g2");
  });
  it("reads the id of a resolved group document", () => {
    expect(groupIdOf({ group: { id: "g3" } })).toBe("g3");
  });
  it("returns null when ungrouped or empty", () => {
    expect(groupIdOf({})).toBeNull();
    expect(groupIdOf({ _source: { group: null }, group: null })).toBeNull();
    expect(groupIdOf({ _source: { group: "" }, group: "" })).toBeNull();
  });
});

describe("majorityName", () => {
  it("returns the most frequent name, first-seen on ties", () => {
    expect(majorityName(["Wolf", "Goblin", "Goblin", "Wolf", "Orc"])).toBe("Wolf");
    expect(majorityName(["Goblin", "Goblin", "Wolf"])).toBe("Goblin");
  });
  it("ignores blank names and returns null when none remain", () => {
    expect(majorityName(["", "  "])).toBeNull();
    expect(majorityName([])).toBeNull();
  });
});

describe("nextGroupName", () => {
  it("uses the base when free", () => {
    expect(nextGroupName(["Wolf"], "Goblin")).toBe("Goblin");
  });
  it("appends the lowest free number", () => {
    expect(nextGroupName(["Goblin", "Goblin 2"], "Goblin")).toBe("Goblin 3");
  });
  it("reuses a gap left by a disbanded group", () => {
    expect(nextGroupName(["Goblin", "Goblin 3"], "Goblin")).toBe("Goblin 2");
  });
});

describe("resolveGroupChoice", () => {
  const groups: GroupRef[] = [{ id: "g1", name: "Goblin", color: "#00ff00" }];
  it("returns none for an empty selection", () => {
    expect(resolveGroupChoice([], groups)).toEqual({ kind: "none" });
  });
  it("creates immediately when the combat has no groups", () => {
    expect(resolveGroupChoice([{ combatantId: null, groupId: null }], [])).toEqual({ kind: "create" });
  });
  it("prompts with the groups when some exist", () => {
    expect(resolveGroupChoice([{ combatantId: "c1", groupId: null }], groups)).toEqual({
      kind: "prompt",
      options: groups,
      offerRemove: false
    });
  });
  it("offers remove only when a selected combatant is grouped", () => {
    const choice = resolveGroupChoice(
      [
        { combatantId: "c1", groupId: "g1" },
        { combatantId: null, groupId: null }
      ],
      groups
    );
    expect(choice).toMatchObject({ kind: "prompt", offerRemove: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/group.test.ts`
Expected: FAIL, `groupIdOf` (and the others) is not exported.

- [ ] **Step 3: Implement.** Append to `src/logic/group.ts`:

```ts
/** Anything carrying a native group reference: a Combatant or a test double. */
export interface GroupCarrier {
  /** Raw stored data; `group` here is always the id string when set. */
  _source?: { group?: string | null } | null;
  /** The runtime field: an id string, the resolved CombatantGroup, or null. */
  group?: string | { id: string } | null;
}

/**
 * Read a combatant's CombatantGroup id regardless of whether the runtime field
 * holds the id or the resolved document (v14 resolves it to the document).
 *
 * @param c - The combatant (or test double).
 * @returns The group id, or `null` when ungrouped.
 */
export function groupIdOf(c: GroupCarrier): string | null {
  const raw = c._source?.group;
  if (typeof raw === "string" && raw.length > 0) return raw;
  const field = c.group;
  if (typeof field === "string") return field.length > 0 ? field : null;
  if (field && typeof field.id === "string" && field.id.length > 0) return field.id;
  return null;
}

/** A group as offered to the GM. */
export interface GroupRef {
  id: string;
  name: string;
  /** Tag color, or `null` for the default. */
  color: string | null;
}

/** One selected token: its combatant (or `null` if not in combat yet) and group. */
export interface SelRef {
  combatantId: string | null;
  groupId: string | null;
}

/** What the Group Selected action should do before any write. */
export type GroupChoice =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "prompt"; options: GroupRef[]; offerRemove: boolean };

/**
 * Decide the Group Selected interaction: nothing for an empty selection, an
 * immediate new group when the combat has none, otherwise a prompt listing the
 * existing groups (with "remove" only when a selected combatant is grouped).
 *
 * @param selected - The selected tokens.
 * @param groups - The combat's existing groups.
 * @returns The {@link GroupChoice}.
 */
export function resolveGroupChoice(selected: readonly SelRef[], groups: readonly GroupRef[]): GroupChoice {
  if (selected.length === 0) return { kind: "none" };
  if (groups.length === 0) return { kind: "create" };
  return {
    kind: "prompt",
    options: [...groups],
    offerRemove: selected.some((sel) => sel.groupId !== null)
  };
}

/**
 * The most frequent non-blank name, first-seen on ties.
 *
 * @param names - Candidate names (e.g. the selected tokens' actor names).
 * @returns The majority name, or `null` when there is none.
 */
export function majorityName(names: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length === 0) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The lowest unused group name: `base`, else `base 2`, `base 3`, ...
 *
 * @param existing - Names already used in the combat.
 * @param base - The preferred name.
 * @returns A name not in `existing`.
 */
export function nextGroupName(existing: readonly string[], base: string): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
```

(`Map` iteration is insertion order, so the strict `>` keeps the first-seen name on ties.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/group.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the Combatant type.** In `src/foundry-env.d.ts`, replace

```ts
  /** The native CombatantGroup id, or null/empty when ungrouped. */
  readonly group?: string | null;
```

with

```ts
  /**
   * The native group: v14 resolves this to the CombatantGroup document; older
   * builds may expose the id. Always read it through `groupIdOf`.
   */
  readonly group?: string | FoundryCombatantGroup | null;
  /** Raw stored data; `group` is the id string. */
  readonly _source?: { group?: string | null };
```

- [ ] **Step 6: Replace every read site.** Add `import { groupIdOf } from "../logic/group";` to each adapter file below, then replace:

| File:line | Old expression | New expression |
| --- | --- | --- |
| `src/adapter/top-bar.ts:52` | `typeof combatant.group === "string" && combatant.group ? combatant.group : null` | `groupIdOf(combatant)` |
| `src/adapter/foundry-adapter.ts:69` | `typeof combatant.group === "string" && combatant.group ? combatant.group : null` | `groupIdOf(combatant)` |
| `src/adapter/foundry-adapter.ts:154` | `(typeof c.group === "string" ? c.group : null) === groupId` | `groupIdOf(c) === groupId` |
| `src/adapter/group-control.ts:26` | `(typeof combatant.group === "string" ? combatant.group : null) === groupId` | `groupIdOf(combatant) === groupId` |
| `src/adapter/groups.ts:63` | `combatant && typeof combatant.group === "string" ? combatant.group : null` | `combatant ? groupIdOf(combatant) : null` |
| `src/adapter/groups.ts:72` | `(typeof c.group === "string" ? c.group : null) === groupId` | `groupIdOf(c) === groupId` |
| `src/adapter/groups.ts:108` | `(typeof c.group === "string" ? c.group : null) === groupId` | `groupIdOf(c) === groupId` |
| `src/adapter/group-ui.ts:98-99` | `const group = location && typeof location.combatant.group === "string" ? location.combatant.group : null;` + `return group && group.length > 0 ? group : null;` | `return location ? groupIdOf(location.combatant) : null;` |
| `src/adapter/group-ui.ts:388` | `combatant && typeof combatant.group === "string" ? combatant.group : null` | `combatant ? groupIdOf(combatant) : null` |
| `src/adapter/hooks.ts:111` | `typeof combatant.group === "string" && combatant.group.length > 0` | `groupIdOf(combatant) !== null` |
| `src/adapter/boss-slots.ts:75` | `if (typeof combatant.group === "string" && combatant.group) return;` | `if (groupIdOf(combatant) !== null) return;` |

Then confirm nothing is left:

Run: `grep -rn "typeof .*\.group ===" src`
Expected: no output.

- [ ] **Step 7: Full check**

Run: `npm run check`
Expected: typecheck clean, all tests pass, build writes `scripts/main.js`.

- [ ] **Step 8: Commit**

```bash
git add src test scripts/main.js scripts/main.js.map
git commit -m "fix: read combatant groups via groupIdOf (v14 resolves group to a document)"
```

---

### Task 2: Pure turn helpers (one turn per group)

**Files:**
- Create: `src/logic/turns.ts`
- Create: `test/turns.test.ts`

**Interfaces:**
- Produces:
  - `interface TurnRef { id: string; groupId: string | null; defeated: boolean }`
  - `type TurnAdjust = { kind: "keep" } | { kind: "set"; turn: number } | { kind: "nextRound" }`
  - `adjustTurn(turns: readonly TurnRef[], from: number | null, to: number, direction: 1 | -1, skipDefeated: boolean): TurnAdjust`
  - `interface SortRef { initiative: number | null; groupId: string | null }`
  - `groupTieBreak(a: SortRef, b: SortRef): number`

- [ ] **Step 1: Write the failing tests.** Create `test/turns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adjustTurn, groupTieBreak, type TurnRef } from "../src/logic/turns";

function t(id: string, groupId: string | null = null, defeated = false): TurnRef {
  return { id, groupId, defeated };
}

// Order: solo a, group g (m1, m2, m3), solo b.
const turns = [t("a"), t("m1", "g"), t("m2", "g"), t("m3", "g"), t("b")];

describe("adjustTurn", () => {
  it("keeps a forward step from an ungrouped combatant", () => {
    expect(adjustTurn(turns, 0, 1, 1, false)).toEqual({ kind: "keep" });
  });
  it("forward from a group member skips the rest of the group", () => {
    expect(adjustTurn(turns, 1, 2, 1, false)).toEqual({ kind: "set", turn: 4 });
  });
  it("forward skip past the end asks for next round", () => {
    const tail = [t("a"), t("m1", "g"), t("m2", "g")];
    expect(adjustTurn(tail, 1, 2, 1, false)).toEqual({ kind: "nextRound" });
  });
  it("forward skip also skips defeated combatants when skipDefeated is on", () => {
    const withDead = [t("m1", "g"), t("m2", "g"), t("x", null, true), t("b")];
    expect(adjustTurn(withDead, 0, 1, 1, true)).toEqual({ kind: "set", turn: 3 });
    expect(adjustTurn(withDead, 0, 1, 1, false)).toEqual({ kind: "set", turn: 2 });
  });
  it("backward lands on the first member of the target's group", () => {
    expect(adjustTurn(turns, 4, 3, -1, false)).toEqual({ kind: "set", turn: 1 });
  });
  it("backward onto an ungrouped combatant is kept", () => {
    expect(adjustTurn(turns, 1, 0, -1, false)).toEqual({ kind: "keep" });
  });
  it("keeps out-of-range targets untouched", () => {
    expect(adjustTurn(turns, 1, 9, 1, false)).toEqual({ kind: "keep" });
    expect(adjustTurn(turns, null, 0, 1, false)).toEqual({ kind: "keep" });
  });
});

describe("groupTieBreak", () => {
  it("does not interfere when initiatives differ or are unset", () => {
    expect(groupTieBreak({ initiative: 15, groupId: "g" }, { initiative: 12, groupId: null })).toBe(0);
    expect(groupTieBreak({ initiative: null, groupId: "g" }, { initiative: null, groupId: "h" })).toBe(0);
  });
  it("keeps same-initiative members of one group together", () => {
    expect(groupTieBreak({ initiative: 12, groupId: "g" }, { initiative: 12, groupId: "g" })).toBe(0);
    expect(groupTieBreak({ initiative: 12, groupId: "g" }, { initiative: 12, groupId: "h" })).toBeLessThan(0);
    expect(groupTieBreak({ initiative: 12, groupId: "h" }, { initiative: 12, groupId: "g" })).toBeGreaterThan(0);
  });
  it("sorts ungrouped before grouped on a tie", () => {
    expect(groupTieBreak({ initiative: 12, groupId: null }, { initiative: 12, groupId: "g" })).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/turns.test.ts`
Expected: FAIL, cannot resolve `../src/logic/turns`.

- [ ] **Step 3: Implement.** Create `src/logic/turns.ts`:

```ts
/**
 * @file Pure turn-order rules that make a combatant group act once: turn skipping
 * across a group's members and a sort tie-break that keeps members adjacent. No
 * Foundry globals; the adapter maps Combat state in and applies the result.
 */

/** One entry of `combat.turns`, reduced to what turn skipping needs. */
export interface TurnRef {
  id: string;
  groupId: string | null;
  defeated: boolean;
}

/** How to change a pending turn update. */
export type TurnAdjust = { kind: "keep" } | { kind: "set"; turn: number } | { kind: "nextRound" };

/**
 * Adjust a pending turn change so a group takes one turn. Forward from a grouped
 * combatant skips its remaining members (and defeated combatants when
 * `skipDefeated`); running off the end asks for the next round. Backward onto a
 * grouped combatant lands on that group's first member.
 *
 * @param turns - `combat.turns` in order.
 * @param from - The current turn index, or `null` before the first turn.
 * @param to - The turn index core is about to set.
 * @param direction - `1` forward, `-1` backward.
 * @param skipDefeated - The combat's "skip defeated" setting.
 * @returns The {@link TurnAdjust}.
 */
export function adjustTurn(
  turns: readonly TurnRef[],
  from: number | null,
  to: number,
  direction: 1 | -1,
  skipDefeated: boolean
): TurnAdjust {
  if (from === null || to < 0 || to >= turns.length) return { kind: "keep" };
  if (direction === 1) {
    const groupId = turns[from]?.groupId ?? null;
    if (groupId === null) return { kind: "keep" };
    let index = to;
    while (index < turns.length) {
      const entry = turns[index];
      if (!entry) break;
      const sameGroup = entry.groupId === groupId;
      const skippable = skipDefeated && entry.defeated;
      if (!sameGroup && !skippable) break;
      index += 1;
    }
    if (index >= turns.length) return { kind: "nextRound" };
    return index === to ? { kind: "keep" } : { kind: "set", turn: index };
  }
  const groupId = turns[to]?.groupId ?? null;
  if (groupId === null) return { kind: "keep" };
  let index = to;
  while (index > 0 && turns[index - 1]?.groupId === groupId) index -= 1;
  return index === to ? { kind: "keep" } : { kind: "set", turn: index };
}

/** A combatant reduced to what the sort tie-break needs. */
export interface SortRef {
  initiative: number | null;
  groupId: string | null;
}

/**
 * Tie-break for equal initiative so a group's members stay adjacent: compare
 * group ids (ungrouped first). Returns 0 when initiatives differ or are unset, so
 * the caller falls through to core ordering.
 *
 * @param a - First combatant.
 * @param b - Second combatant.
 * @returns Negative, zero, or positive, as for `Array.prototype.sort`.
 */
export function groupTieBreak(a: SortRef, b: SortRef): number {
  if (a.initiative === null || b.initiative === null || a.initiative !== b.initiative) return 0;
  const keyA = a.groupId ?? "";
  const keyB = b.groupId ?? "";
  if (keyA === keyB) return 0;
  return keyA < keyB ? -1 : 1;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/turns.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check + commit**

Run: `npm run check` (expected: green)

```bash
git add src/logic/turns.ts test/turns.test.ts scripts/main.js scripts/main.js.map
git commit -m "feat: pure turn rules so a combatant group takes one turn"
```

---

### Task 3: Tracker view - stacked-portrait group rows

**Files:**
- Modify: `src/logic/tracker-view.ts:62-72` (group variant of `TrackerRow`), `:118-134` (group branch)
- Modify: `test/tracker-view.test.ts`

**Interfaces:**
- Produces: group `TrackerRow` gains `portraits: string[]` (max 3), `members: TrackerMember[]`, `living: number`; `memberCount` stays (visible total); `img` equals `portraits[0] ?? null`.
  - `interface TrackerMember { id: string; name: string; img: string | null; defeated: boolean }`

- [ ] **Step 1: Write the failing tests.** Append inside the `describe("buildTrackerView")` block in `test/tracker-view.test.ts`:

```ts
  it("stacks up to three living member portraits, in turn order", () => {
    const rows = buildTrackerView(
      input([
        c({ id: "m1", groupId: "g" }),
        c({ id: "m2", groupId: "g", isDefeated: true }),
        c({ id: "m3", groupId: "g" }),
        c({ id: "m4", groupId: "g" }),
        c({ id: "m5", groupId: "g" })
      ]),
      GM
    );
    expect(rows[0]).toMatchObject({
      kind: "group",
      portraits: ["m1.png", "m3.png", "m4.png"],
      img: "m1.png",
      living: 4,
      memberCount: 5
    });
  });

  it("lists members with defeated state for the expand popover", () => {
    const rows = buildTrackerView(
      input([c({ id: "m1", groupId: "g" }), c({ id: "m2", groupId: "g", isDefeated: true })]),
      GM
    );
    expect(rows[0]).toMatchObject({
      members: [
        { id: "m1", name: "m1", img: "m1.png", defeated: false },
        { id: "m2", name: "m2", img: "m2.png", defeated: true }
      ]
    });
  });

  it("never leaks hidden members to players in portraits or members", () => {
    const rows = buildTrackerView(
      input([c({ id: "m1", groupId: "g" }), c({ id: "m2", groupId: "g", hidden: true })]),
      PLAYER
    );
    expect(rows[0]).toMatchObject({ portraits: ["m1.png"], members: [{ id: "m1" }], living: 1 });
  });

  it("falls back to defeated portraits when every member is down", () => {
    const rows = buildTrackerView(input([c({ id: "m1", groupId: "g", isDefeated: true })]), GM);
    expect(rows[0]).toMatchObject({ portraits: ["m1.png"], living: 0 });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/tracker-view.test.ts`
Expected: FAIL, `portraits` undefined.

- [ ] **Step 3: Implement.** In `src/logic/tracker-view.ts`, add above `TrackerRow`:

```ts
/** A group member as listed in the top bar's expand popover. */
export interface TrackerMember {
  id: string;
  name: string;
  img: string | null;
  defeated: boolean;
}
```

Replace the group variant of `TrackerRow` with:

```ts
  | {
      kind: "group";
      groupId: string;
      name: string;
      color: string;
      /** Visible members, living or not. */
      memberCount: number;
      /** Visible members not defeated. */
      living: number;
      initiative: number | null;
      /** First stacked portrait (kept for existing callers). */
      img: string | null;
      /** Up to three portraits of living members (all members if none alive). */
      portraits: string[];
      /** Visible members in turn order. */
      members: TrackerMember[];
      isCurrent: boolean;
    };
```

Replace the `rows.push({ kind: "group", ... })` call with:

```ts
      const group = meta.get(combatant.groupId);
      const alive = members.filter((member) => !member.isDefeated);
      const portraits = (alive.length > 0 ? alive : members)
        .map((member) => member.img)
        .filter((img): img is string => img !== null)
        .slice(0, 3);
      rows.push({
        kind: "group",
        groupId: combatant.groupId,
        name: group?.name ?? "",
        color: group?.color ?? DEFAULT_GROUP_COLOR,
        memberCount: members.length,
        living: alive.length,
        initiative: combatant.initiative,
        img: portraits[0] ?? null,
        portraits,
        members: members.map((member) => ({
          id: member.id,
          name: member.name,
          img: member.img,
          defeated: member.isDefeated
        })),
        isCurrent: members.some((member) => member.id === input.currentId)
      });
```

(Delete the now-duplicate `const group = meta.get(...)` line above it.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/tracker-view.test.ts`
Expected: PASS (old and new cases).

- [ ] **Step 5: Full check + commit**

Run: `npm run check`

```bash
git add src/logic/tracker-view.ts test/tracker-view.test.ts scripts/main.js scripts/main.js.map
git commit -m "feat: stacked-portrait group rows in the tracker view model"
```

---

### Task 4: `GroupingService` + port + fake

**Files:**
- Create: `src/grouping-service.ts`
- Create: `test/fake-grouping-port.ts`
- Create: `test/grouping-service.test.ts`

**Interfaces:**
- Consumes: `GroupRef`, `SelRef`, `resolveGroupChoice`, `majorityName`, `nextGroupName` (Task 1).
- Produces (exported from `src/grouping-service.ts`):

```ts
export interface GroupingCombatantRef {
  id: string;
  tokenId: string | null;
  groupId: string | null;
  initiative: number | null;
  /** True for a boss's module-created "end" slot (shares the boss tokenId). */
  bossEndSlot: boolean;
}
export interface GroupPromptRequest { options: GroupRef[]; offerRemove: boolean; defaultName: string }
export type GroupPromptResult =
  | { action: "new"; name: string }
  | { action: "join"; groupId: string }
  | { action: "remove" }
  | null;
export interface GroupingPort {
  resolveCombat(): Promise<string | null>;
  listCombatants(combatId: string): GroupingCombatantRef[];
  listGroups(combatId: string): GroupRef[];
  isStarted(combatId: string): boolean;
  tokenActorNames(tokenIds: readonly string[]): string[];
  fallbackGroupName(): string;
  createGroup(combatId: string, name: string): Promise<string>;
  createCombatants(combatId: string, tokenIds: readonly string[], groupId: string, initiative: number | null): Promise<string[]>;
  assign(combatId: string, ids: readonly string[], groupId: string, initiative: number | null): Promise<void>;
  unassign(combatId: string, ids: readonly string[]): Promise<void>;
  deleteGroup(combatId: string, groupId: string): Promise<void>;
  rollGroupInitiative(combatId: string, groupId: string): Promise<number | null>;
  setInitiative(combatId: string, ids: readonly string[], value: number): Promise<void>;
  tearDownBoss(combatId: string, ids: readonly string[]): Promise<void>;
  reconcileBoss(combatId: string, ids: readonly string[]): Promise<void>;
  prompt(request: GroupPromptRequest): Promise<GroupPromptResult>;
  warn(key: "NothingSelected" | "NoScene"): void;
}
export class GroupingService { constructor(port: GroupingPort); groupSelected(tokenIds: readonly string[]): Promise<void> }
```

- [ ] **Step 1: Write the fake.** Create `test/fake-grouping-port.ts`:

```ts
import type { GroupRef } from "../src/logic/group";
import type {
  GroupingCombatantRef,
  GroupingPort,
  GroupPromptRequest,
  GroupPromptResult
} from "../src/grouping-service";

/** Stateful in-memory GroupingPort; records every write in `calls`. */
export class FakeGroupingPort implements GroupingPort {
  public combatId: string | null = "combat";
  public started = false;
  public combatants: GroupingCombatantRef[] = [];
  public groups: GroupRef[] = [];
  public names = new Map<string, string>();
  public promptResult: GroupPromptResult = null;
  public prompts: GroupPromptRequest[] = [];
  public rollValue: number | null = 15;
  public calls: string[] = [];
  public warnings: string[] = [];
  private nextId = 1;

  public async resolveCombat(): Promise<string | null> {
    this.calls.push("resolveCombat");
    return this.combatId;
  }
  public listCombatants(): GroupingCombatantRef[] {
    return this.combatants.map((c) => ({ ...c }));
  }
  public listGroups(): GroupRef[] {
    return this.groups.map((g) => ({ ...g }));
  }
  public isStarted(): boolean {
    return this.started;
  }
  public tokenActorNames(tokenIds: readonly string[]): string[] {
    return tokenIds.map((id) => this.names.get(id) ?? "");
  }
  public fallbackGroupName(): string {
    return "Group";
  }
  public async createGroup(_combatId: string, name: string): Promise<string> {
    const id = `g${this.nextId++}`;
    this.groups.push({ id, name, color: null });
    this.calls.push(`createGroup:${name}`);
    return id;
  }
  public async createCombatants(
    _combatId: string,
    tokenIds: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<string[]> {
    const ids = tokenIds.map((tokenId) => {
      const id = `c${this.nextId++}`;
      this.combatants.push({ id, tokenId, groupId, initiative, bossEndSlot: false });
      return id;
    });
    this.calls.push(`createCombatants:${tokenIds.join(",")}:${groupId}:${initiative}`);
    return ids;
  }
  public async assign(
    _combatId: string,
    ids: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<void> {
    for (const c of this.combatants) {
      if (!ids.includes(c.id)) continue;
      c.groupId = groupId;
      if (initiative !== null) c.initiative = initiative;
    }
    this.calls.push(`assign:${ids.join(",")}:${groupId}:${initiative}`);
  }
  public async unassign(_combatId: string, ids: readonly string[]): Promise<void> {
    for (const c of this.combatants) if (ids.includes(c.id)) c.groupId = null;
    this.calls.push(`unassign:${ids.join(",")}`);
  }
  public async deleteGroup(_combatId: string, groupId: string): Promise<void> {
    this.groups = this.groups.filter((g) => g.id !== groupId);
    this.calls.push(`deleteGroup:${groupId}`);
  }
  public async rollGroupInitiative(_combatId: string, groupId: string): Promise<number | null> {
    this.calls.push(`roll:${groupId}`);
    return this.rollValue;
  }
  public async setInitiative(_combatId: string, ids: readonly string[], value: number): Promise<void> {
    for (const c of this.combatants) if (ids.includes(c.id)) c.initiative = value;
    this.calls.push(`setInitiative:${[...ids].sort().join(",")}:${value}`);
  }
  public async tearDownBoss(_combatId: string, ids: readonly string[]): Promise<void> {
    this.calls.push(`tearDownBoss:${ids.join(",")}`);
  }
  public async reconcileBoss(_combatId: string, ids: readonly string[]): Promise<void> {
    this.calls.push(`reconcileBoss:${ids.join(",")}`);
  }
  public async prompt(request: GroupPromptRequest): Promise<GroupPromptResult> {
    this.prompts.push(request);
    return this.promptResult;
  }
  public warn(key: string): void {
    this.warnings.push(key);
  }
}
```

- [ ] **Step 2: Write the failing tests.** Create `test/grouping-service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { GroupingService } from "../src/grouping-service";
import { FakeGroupingPort } from "./fake-grouping-port";

describe("GroupingService.groupSelected", () => {
  let port: FakeGroupingPort;
  let service: GroupingService;

  beforeEach(() => {
    port = new FakeGroupingPort();
    port.names = new Map([
      ["t1", "Goblin"],
      ["t2", "Goblin"],
      ["t3", "Wolf"]
    ]);
    service = new GroupingService(port);
  });

  it("warns and does nothing for an empty selection", async () => {
    await service.groupSelected([]);
    expect(port.warnings).toEqual(["NothingSelected"]);
    expect(port.calls).toEqual([]);
  });

  it("warns when no combat can be resolved", async () => {
    port.combatId = null;
    await service.groupSelected(["t1"]);
    expect(port.warnings).toEqual(["NoScene"]);
  });

  it("with no groups: creates the group first, then combatants born in it", async () => {
    await service.groupSelected(["t1", "t2", "t3"]);
    expect(port.prompts).toEqual([]);
    expect(port.calls).toEqual(["resolveCombat", "createGroup:Goblin", "createCombatants:t1,t2,t3:g1:null"]);
  });

  it("deduplicates token ids", async () => {
    await service.groupSelected(["t1", "t1"]);
    expect(port.calls).toContain("createCombatants:t1:g1:null");
  });

  it("prompts when groups exist, with a collision-free default name", async () => {
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    await service.groupSelected(["t1", "t2"]);
    expect(port.prompts).toEqual([
      { options: [{ id: "gx", name: "Goblin", color: null }], offerRemove: false, defaultName: "Goblin 2" }
    ]);
  });

  it("dismiss writes nothing", async () => {
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    port.promptResult = null;
    await service.groupSelected(["t1"]);
    expect(port.calls).toEqual(["resolveCombat"]);
  });

  it("uses the default name when the typed name is blank", async () => {
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    port.promptResult = { action: "new", name: "   " };
    await service.groupSelected(["t1"]);
    expect(port.calls).toContain("createGroup:Goblin 2");
  });

  it("joining an existing group in a started combat copies a member's initiative", async () => {
    port.started = true;
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    port.combatants = [
      { id: "old", tokenId: "t9", groupId: "gx", initiative: 12, bossEndSlot: false },
      { id: "c1", tokenId: "t1", groupId: null, initiative: 7, bossEndSlot: false }
    ];
    port.promptResult = { action: "join", groupId: "gx" };
    await service.groupSelected(["t1", "t2"]);
    expect(port.calls).toContain("assign:c1:gx:12");
    expect(port.calls).toContain("createCombatants:t2:gx:12");
    expect(port.calls.some((call) => call.startsWith("roll:"))).toBe(false);
  });

  it("a new group in a started combat rolls once and sets every member", async () => {
    port.started = true;
    port.combatants = [{ id: "c1", tokenId: "t1", groupId: null, initiative: 7, bossEndSlot: false }];
    port.rollValue = 18;
    await service.groupSelected(["t1", "t2"]);
    const roll = port.calls.indexOf("roll:g1");
    expect(roll).toBeGreaterThan(port.calls.indexOf("createCombatants:t2:g1:null"));
    expect(port.calls[roll + 1]).toMatch(/^setInitiative:c1,c\d+:18$/);
  });

  it("an unstarted combat never rolls", async () => {
    await service.groupSelected(["t1"]);
    expect(port.calls.some((call) => call.startsWith("roll:"))).toBe(false);
  });

  it("moving the last member out of a group deletes that group and tears down boss slots", async () => {
    port.groups = [{ id: "ga", name: "Wolf", color: null }];
    port.combatants = [{ id: "c3", tokenId: "t3", groupId: "ga", initiative: null, bossEndSlot: false }];
    port.promptResult = { action: "new", name: "Pack" };
    await service.groupSelected(["t3"]);
    expect(port.calls).toEqual([
      "resolveCombat",
      "createGroup:Pack",
      "assign:c3:g1:null",
      "tearDownBoss:c3",
      "deleteGroup:ga"
    ]);
  });

  it("skips combatants already in the target group", async () => {
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    port.combatants = [{ id: "c1", tokenId: "t1", groupId: "gx", initiative: null, bossEndSlot: false }];
    port.promptResult = { action: "join", groupId: "gx" };
    await service.groupSelected(["t1"]);
    expect(port.calls).toEqual(["resolveCombat"]);
  });

  it("ignores boss end slots that share the boss tokenId", async () => {
    port.combatants = [
      { id: "start", tokenId: "tb", groupId: null, initiative: 10001, bossEndSlot: false },
      { id: "end", tokenId: "tb", groupId: null, initiative: -10001, bossEndSlot: true }
    ];
    await service.groupSelected(["tb"]);
    expect(port.calls).toContain("assign:start:g1:null");
    expect(port.calls.join("|")).not.toContain("end");
  });

  it("remove: ungroups, restores boss slots, and deletes an emptied group", async () => {
    port.groups = [{ id: "ga", name: "Wolf", color: null }];
    port.combatants = [
      { id: "c3", tokenId: "t3", groupId: "ga", initiative: 9, bossEndSlot: false },
      { id: "c4", tokenId: "t4", groupId: null, initiative: 5, bossEndSlot: false }
    ];
    port.promptResult = { action: "remove" };
    await service.groupSelected(["t3", "t4"]);
    expect(port.prompts[0]?.offerRemove).toBe(true);
    expect(port.calls).toEqual(["resolveCombat", "unassign:c3", "reconcileBoss:c3", "deleteGroup:ga"]);
  });

  it("falls back to the i18n base name when no token has a name", async () => {
    port.names = new Map();
    await service.groupSelected(["t1"]);
    expect(port.calls).toContain("createGroup:Group");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/grouping-service.test.ts`
Expected: FAIL, cannot resolve `../src/grouping-service`.

- [ ] **Step 4: Implement.** Create `src/grouping-service.ts`:

```ts
/**
 * @file The Group Selected action, orchestrated behind the {@link GroupingPort}
 * seam so the ordering rules are unit-tested against a fake: the target group is
 * decided (and created) BEFORE any combatant is created, so the createCombatant
 * hook sees new combatants as grouped and skips boss slots and tag prompts. The
 * Foundry binding lives in src/adapter/grouping.ts.
 */

import {
  majorityName,
  nextGroupName,
  resolveGroupChoice,
  type GroupRef,
  type SelRef
} from "./logic/group";

/** A combatant reduced to what grouping needs. */
export interface GroupingCombatantRef {
  id: string;
  tokenId: string | null;
  groupId: string | null;
  initiative: number | null;
  /** True for a boss's module-created "end" slot (shares the boss tokenId). */
  bossEndSlot: boolean;
}

/** What the group dialog is asked to show. */
export interface GroupPromptRequest {
  options: GroupRef[];
  offerRemove: boolean;
  defaultName: string;
}

/** The GM's answer from the group dialog; `null` when dismissed. */
export type GroupPromptResult =
  | { action: "new"; name: string }
  | { action: "join"; groupId: string }
  | { action: "remove" }
  | null;

/** The seam between {@link GroupingService} and Foundry. */
export interface GroupingPort {
  /** Find (or create) and activate the viewed scene's combat; `null` with no scene. */
  resolveCombat(): Promise<string | null>;
  /** Every combatant of the combat, in any order. */
  listCombatants(combatId: string): GroupingCombatantRef[];
  /** The combat's groups. */
  listGroups(combatId: string): GroupRef[];
  /** Whether the combat has started (round >= 1). */
  isStarted(combatId: string): boolean;
  /** Actor (or token) names for the given tokens, in order. */
  tokenActorNames(tokenIds: readonly string[]): string[];
  /** Localized base name used when no token name is available. */
  fallbackGroupName(): string;
  /** Create a CombatantGroup; resolves to its id. */
  createGroup(combatId: string, name: string): Promise<string>;
  /** Create combatants for tokens, born in `groupId`; resolves to their ids. */
  createCombatants(
    combatId: string,
    tokenIds: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<string[]>;
  /** Move combatants into a group; `initiative` null leaves initiative unchanged. */
  assign(combatId: string, ids: readonly string[], groupId: string, initiative: number | null): Promise<void>;
  /** Clear combatants' group. */
  unassign(combatId: string, ids: readonly string[]): Promise<void>;
  /** Delete a CombatantGroup. */
  deleteGroup(combatId: string, groupId: string): Promise<void>;
  /** Roll one initiative for a group; `null` if it cannot roll. */
  rollGroupInitiative(combatId: string, groupId: string): Promise<number | null>;
  /** Set the same initiative on several combatants in one batch. */
  setInitiative(combatId: string, ids: readonly string[], value: number): Promise<void>;
  /** Remove boss double-turn slots from combatants that just joined a group. */
  tearDownBoss(combatId: string, ids: readonly string[]): Promise<void>;
  /** Restore boss double-turn slots for combatants that just left a group. */
  reconcileBoss(combatId: string, ids: readonly string[]): Promise<void>;
  /** Show the group dialog. */
  prompt(request: GroupPromptRequest): Promise<GroupPromptResult>;
  /** Show a localized warning. */
  warn(key: "NothingSelected" | "NoScene"): void;
}

/** Runs the battlemap Group Selected action. */
export class GroupingService {
  /**
   * @param port - The Foundry seam.
   */
  public constructor(private readonly port: GroupingPort) {}

  /**
   * Group the given tokens: add missing ones to combat, then create, join, or
   * leave a group per {@link resolveGroupChoice} and the GM's dialog answer.
   *
   * @param tokenIds - Selected token ids (duplicates allowed).
   */
  public async groupSelected(tokenIds: readonly string[]): Promise<void> {
    const unique = [...new Set(tokenIds)];
    if (unique.length === 0) {
      this.port.warn("NothingSelected");
      return;
    }
    const combatId = await this.port.resolveCombat();
    if (combatId === null) {
      this.port.warn("NoScene");
      return;
    }
    const before = this.port.listCombatants(combatId);
    const byToken = new Map<string, GroupingCombatantRef>();
    for (const combatant of before) {
      if (combatant.bossEndSlot || combatant.tokenId === null) continue;
      if (!unique.includes(combatant.tokenId) || byToken.has(combatant.tokenId)) continue;
      byToken.set(combatant.tokenId, combatant);
    }
    const inCombat = [...byToken.values()];
    const newTokens = unique.filter((tokenId) => !byToken.has(tokenId));
    const selected: SelRef[] = [
      ...inCombat.map((c) => ({ combatantId: c.id, groupId: c.groupId })),
      ...newTokens.map(() => ({ combatantId: null, groupId: null }))
    ];
    const groups = this.port.listGroups(combatId);
    const choice = resolveGroupChoice(selected, groups);
    if (choice.kind === "none") return;
    const base = majorityName(this.port.tokenActorNames(unique)) ?? this.port.fallbackGroupName();
    const defaultName = nextGroupName(
      groups.map((group) => group.name),
      base
    );
    const result: GroupPromptResult =
      choice.kind === "create"
        ? { action: "new", name: defaultName }
        : await this.port.prompt({ options: choice.options, offerRemove: choice.offerRemove, defaultName });
    if (result === null) return;
    if (result.action === "remove") {
      await this.leave(
        combatId,
        inCombat.filter((c) => c.groupId !== null)
      );
      return;
    }
    const targetId =
      result.action === "join"
        ? result.groupId
        : await this.port.createGroup(combatId, result.name.trim() || defaultName);
    await this.join(combatId, before, inCombat, newTokens, targetId);
  }

  /** Put selected combatants and new tokens into `targetId`, then settle initiative. */
  private async join(
    combatId: string,
    before: readonly GroupingCombatantRef[],
    inCombat: readonly GroupingCombatantRef[],
    newTokens: readonly string[],
    targetId: string
  ): Promise<void> {
    const started = this.port.isStarted(combatId);
    const shared = started
      ? (before.find((c) => c.groupId === targetId && c.initiative !== null)?.initiative ?? null)
      : null;
    const moving = inCombat.filter((c) => c.groupId !== targetId).map((c) => c.id);
    if (moving.length > 0) {
      await this.port.assign(combatId, moving, targetId, shared);
      await this.port.tearDownBoss(combatId, moving);
    }
    if (newTokens.length > 0) await this.port.createCombatants(combatId, newTokens, targetId, shared);
    if (started && shared === null && (moving.length > 0 || newTokens.length > 0)) {
      const value = await this.port.rollGroupInitiative(combatId, targetId);
      if (value !== null) {
        const members = this.port
          .listCombatants(combatId)
          .filter((c) => c.groupId === targetId)
          .map((c) => c.id);
        await this.port.setInitiative(combatId, members, value);
      }
    }
    await this.sweep(
      combatId,
      inCombat.map((c) => c.groupId)
    );
  }

  /** Remove combatants from their groups and restore their boss slots. */
  private async leave(combatId: string, refs: readonly GroupingCombatantRef[]): Promise<void> {
    if (refs.length === 0) return;
    const ids = refs.map((ref) => ref.id);
    await this.port.unassign(combatId, ids);
    await this.port.reconcileBoss(combatId, ids);
    await this.sweep(
      combatId,
      refs.map((ref) => ref.groupId)
    );
  }

  /** Delete any candidate group that no longer has members. */
  private async sweep(combatId: string, candidates: readonly (string | null)[]): Promise<void> {
    const used = new Set(this.port.listCombatants(combatId).map((c) => c.groupId));
    for (const groupId of new Set(candidates)) {
      if (groupId !== null && !used.has(groupId)) await this.port.deleteGroup(combatId, groupId);
    }
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/grouping-service.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: Full check + commit**

Run: `npm run check`

```bash
git add src/grouping-service.ts test/fake-grouping-port.ts test/grouping-service.test.ts scripts/main.js scripts/main.js.map
git commit -m "feat: GroupingService decides the group before creating combatants"
```

---

### Task 5: happy-dom menu module + `runSafe`, wired into the top bar

**Files:**
- Modify: `package.json` (devDependency `happy-dom`)
- Create: `src/ui/menu.ts`
- Create: `src/ui/run-safe.ts`
- Create: `test/ui-menu.test.ts`
- Create: `test/run-safe.test.ts`
- Modify: `src/foundry-env.d.ts` (`FoundryNotifications.error`)
- Modify: `src/adapter/top-bar.ts:97-145` (replace local menu), `:250-262` (redraw hooks)

**Interfaces:**
- Produces:
  - `src/ui/run-safe.ts`: `type ErrorReporter = (label: string, error: unknown) => void`; `runSafe(label: string, fn: () => unknown, report?: ErrorReporter): Promise<void>`
  - `src/ui/menu.ts`: `interface MenuItem { label: string; run: () => unknown }`; `openMenu(doc: Document, id: string, className: string, items: readonly MenuItem[], x: number, y: number, report?: ErrorReporter): HTMLElement | null`; `closeMenu(doc: Document, id: string): void`

- [ ] **Step 1: Install happy-dom**

Run: `npm install --save-dev happy-dom@^15`
Expected: `package.json` gains `"happy-dom": "^15.x"`.

- [ ] **Step 2: Write the failing tests.** Create `test/run-safe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runSafe } from "../src/ui/run-safe";

describe("runSafe", () => {
  it("reports an async rejection with its label", async () => {
    const seen: [string, unknown][] = [];
    await runSafe("group", async () => {
      throw new Error("boom");
    }, (label, error) => seen.push([label, error]));
    expect(seen[0]?.[0]).toBe("group");
    expect((seen[0]?.[1] as Error).message).toBe("boom");
  });
  it("reports a synchronous throw", async () => {
    const seen: string[] = [];
    await runSafe("sync", () => {
      throw new Error("x");
    }, (label) => seen.push(label));
    expect(seen).toEqual(["sync"]);
  });
  it("does not report success", async () => {
    const seen: string[] = [];
    await runSafe("ok", async () => 1, (label) => seen.push(label));
    expect(seen).toEqual([]);
  });
});
```

Create `test/ui-menu.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { closeMenu, openMenu } from "../src/ui/menu";

const ID = "ti-menu";

afterEach(() => {
  closeMenu(document, ID);
});

function pointer(type: string, target: EventTarget): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true }));
}

describe("openMenu", () => {
  it("pointerdown then click on an item runs it", async () => {
    let ran = 0;
    const menu = openMenu(document, ID, "m", [{ label: "Tag", run: () => { ran += 1; } }], 10, 20);
    const item = menu?.querySelector("button");
    expect(item).toBeTruthy();
    pointer("pointerdown", item as HTMLElement);
    (item as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ran).toBe(1);
    expect(document.getElementById(ID)).toBeNull();
  });

  it("pointerdown outside closes the menu", () => {
    openMenu(document, ID, "m", [{ label: "Tag", run: () => undefined }], 0, 0);
    pointer("pointerdown", document.body);
    expect(document.getElementById(ID)).toBeNull();
  });

  it("returns null and shows nothing for an empty item list", () => {
    expect(openMenu(document, ID, "m", [], 0, 0)).toBeNull();
    expect(document.getElementById(ID)).toBeNull();
  });

  it("reopening replaces the previous menu and its outside listener", () => {
    openMenu(document, ID, "m", [{ label: "A", run: () => undefined }], 0, 0);
    const second = openMenu(document, ID, "m", [{ label: "B", run: () => undefined }], 0, 0);
    expect(document.querySelectorAll(`#${ID}`)).toHaveLength(1);
    pointer("pointerdown", second as HTMLElement);
    expect(document.getElementById(ID)).toBe(second);
  });

  it("reports a failing item through the reporter", async () => {
    const seen: string[] = [];
    const menu = openMenu(
      document,
      ID,
      "m",
      [{ label: "Bad", run: () => { throw new Error("no"); } }],
      0,
      0,
      (label) => seen.push(label)
    );
    (menu?.querySelector("button") as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["menu:Bad"]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/run-safe.test.ts test/ui-menu.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/ui/run-safe.ts`:**

```ts
/**
 * @file Await a UI callback and report any failure instead of dropping it. No
 * Foundry globals are required; the default reporter uses `ui.notifications`
 * only when it exists.
 */

/** Receives a failed callback's label and error. */
export type ErrorReporter = (label: string, error: unknown) => void;

/** Log to the console and, inside Foundry, show an error notification. */
const defaultReport: ErrorReporter = (label, error) => {
  console.error(`tactical-initiative | ${label}`, error);
  const notes = (globalThis as { ui?: { notifications?: { error?: (msg: string) => void } } }).ui
    ?.notifications;
  notes?.error?.(`Tactical Initiative: ${label} failed; see console (F12).`);
};

/**
 * Run `fn` (sync or async) and report a throw or rejection. Never rejects.
 *
 * @param label - Short diagnostic label.
 * @param fn - The callback.
 * @param report - Failure sink; defaults to console + notification.
 * @returns Resolves when `fn` settles.
 */
export function runSafe(label: string, fn: () => unknown, report: ErrorReporter = defaultReport): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(
      () => undefined,
      (error: unknown) => {
        report(label, error);
      }
    );
}
```

- [ ] **Step 5: Implement `src/ui/menu.ts`:**

```ts
/**
 * @file A tiny fixed-position context menu with no Foundry dependencies, so its
 * event handling is tested under happy-dom. Closes on a pointerdown OUTSIDE the
 * menu only; a pointerdown on an item must not remove the item before its click
 * fires (the v1.5.0 dead-menu bug).
 */

import { runSafe, type ErrorReporter } from "./run-safe";

/** One menu entry. */
export interface MenuItem {
  label: string;
  run: () => unknown;
}

/** Outside-click listeners per menu id, so close() can detach them. */
const outsideListeners = new Map<string, (event: Event) => void>();

/**
 * Remove the menu with `id` and its outside-click listener.
 *
 * @param doc - The document hosting the menu.
 * @param id - The menu element id.
 */
export function closeMenu(doc: Document, id: string): void {
  const listener = outsideListeners.get(id);
  if (listener) {
    doc.removeEventListener("pointerdown", listener, true);
    outsideListeners.delete(id);
  }
  doc.getElementById(id)?.remove();
}

/**
 * Open a menu at viewport (x, y), replacing any open menu with the same id.
 *
 * @param doc - The document to render into.
 * @param id - Element id (one menu per id).
 * @param className - CSS class; items get `${className}-item`.
 * @param items - Entries; none means no menu.
 * @param x - Left, px.
 * @param y - Top, px.
 * @param report - Failure sink passed to {@link runSafe}.
 * @returns The menu element, or `null` when `items` is empty.
 */
export function openMenu(
  doc: Document,
  id: string,
  className: string,
  items: readonly MenuItem[],
  x: number,
  y: number,
  report?: ErrorReporter
): HTMLElement | null {
  closeMenu(doc, id);
  if (items.length === 0) return null;
  const menu = doc.createElement("nav");
  menu.id = id;
  menu.className = className;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const entry of items) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `${className}-item`;
    button.textContent = entry.label;
    button.addEventListener("click", () => {
      closeMenu(doc, id);
      void runSafe(`menu:${entry.label}`, entry.run, report);
    });
    menu.appendChild(button);
  }
  const outside = (event: Event): void => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    closeMenu(doc, id);
  };
  outsideListeners.set(id, outside);
  doc.addEventListener("pointerdown", outside, true);
  doc.body.appendChild(menu);
  return menu;
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run test/run-safe.test.ts test/ui-menu.test.ts`
Expected: PASS.

- [ ] **Step 7: Wire the top bar.** In `src/foundry-env.d.ts`, add `error(message: string): void;` to `FoundryNotifications`. In `src/adapter/top-bar.ts`:

Delete the local `closeMenu` and `openMenu` functions (lines 104-145) and add imports:

```ts
import { openMenu as openUiMenu, type MenuItem } from "../ui/menu";
```

Add this replacement right after the `MenuEntry` interface:

```ts
/** Menu element id and class for the bar's context menu. */
const MENU_ID = `${MODULE_ID}-tb-menu`;
const MENU_CLASS = `${MODULE_ID}-tb-menu`;

/**
 * Open the combatant-row context menu, reusing the sidebar tag/group builders.
 *
 * @param rowEl - The combatant row element (carries `data-combatant-id`).
 * @param x - Viewport x.
 * @param y - Viewport y.
 */
function openCombatantMenu(rowEl: HTMLElement, x: number, y: number): void {
  const entries: MenuEntry[] = [];
  pushTagOptions(entries);
  pushGroupOptions(entries);
  const items: MenuItem[] = entries
    .filter((entry) => {
      try {
        return entry.condition(rowEl);
      } catch {
        return false;
      }
    })
    .map((entry) => ({ label: entry.name, run: () => entry.callback(rowEl) }));
  openUiMenu(document, MENU_ID, MENU_CLASS, items, x, y);
}
```

In `renderRow`, change the combatant `contextmenu` listener body to `openCombatantMenu(li, event.clientX, event.clientY);`.

Replace the hook loop in `registerTopBar` with:

```ts
  const redrawOn = [
    "createCombat",
    "updateCombat",
    "deleteCombat",
    "createCombatant",
    "updateCombatant",
    "deleteCombatant",
    "createCombatantGroup",
    "updateCombatantGroup",
    "deleteCombatantGroup",
    "updateActor",
    "createToken",
    "deleteToken"
  ];
  for (const hook of redrawOn) {
    Hooks.on(hook, () => {
      render();
    });
  }
```

In `renderControls`, change the turn button listener to:

```ts
    el.addEventListener("click", () => {
      if (isActiveGM()) void runSafe(`turn:${action}`, run);
    });
```

and add `import { runSafe } from "../ui/run-safe";`.

- [ ] **Step 8: Full check + commit**

Run: `npm run check`
Expected: green (happy-dom file runs in its own env; the rest stay node).

```bash
git add package.json package-lock.json src test scripts/main.js scripts/main.js.map
git commit -m "fix: top-bar menu items fire; extract menu + runSafe with happy-dom tests"
```

---

### Task 6: Foundry grouping port, Token HUD button, `G` keybinding, cleanup

**Files:**
- Create: `src/adapter/grouping.ts` (real `GroupingPort` + dialog)
- Create: `src/adapter/grouping-ui.ts` (HUD button, keybinding, entry function)
- Modify: `src/adapter/groups.ts` (delete `addToGroup`; add `sweepEmptyGroups`; `removeFromGroup` restores boss slots)
- Modify: `src/adapter/group-ui.ts` (remove "Add to group", `selectedCombatantIds`, `addSelectionToNewGroup`, `decorateTrackerGroups` and its hook; export `renameGroupInteractive`, `recolorGroupInteractive`; wrap callbacks in `runSafe`)
- Modify: `src/adapter/hooks.ts` (`deleteCombatant` also sweeps empty groups)
- Modify: `src/main.ts` (register keybinding + HUD button)
- Modify: `src/constants.ts` (`KEYBINDINGS`)
- Modify: `src/foundry-env.d.ts` (types listed in Step 1)
- Modify: `lang/en.json`

**Interfaces:**
- Consumes: `GroupingService`, `GroupingPort`, `GroupPromptRequest`, `GroupPromptResult` (Task 4); `runSafe` (Task 5); `groupIdOf`, `GroupRef` (Task 1).
- Produces:
  - `src/adapter/grouping-ui.ts`: `groupSelectedTokens(extraTokenId?: string): Promise<void>`; `registerGroupingKeybinding(): void`; `registerTokenHudButton(): void`
  - `src/adapter/groups.ts`: `sweepEmptyGroups(combat: FoundryCombat): Promise<void>`
  - `src/adapter/group-ui.ts`: `renameGroupInteractive(combat: FoundryCombat, groupId: string): Promise<void>`; `recolorGroupInteractive(combat: FoundryCombat, groupId: string): Promise<void>`

- [ ] **Step 1: Extend the ambient types** in `src/foundry-env.d.ts`:

In `FoundryTokenDocument` add:

```ts
  /** The token's actor (synthetic for unlinked tokens). */
  readonly actor?: FoundryActor | null;
  /** True when the token is hidden from players. */
  readonly hidden?: boolean;
```

In `FoundryCombat` add:

```ts
  /** The scene this combat is linked to, or null when unlinked. */
  readonly scene: { id: string } | null;
  /** True for the combat the tracker is showing. */
  readonly active: boolean;
  /** Current turn index, or null before the first turn. */
  readonly turn: number | null;
  /** Combat settings (core). */
  readonly settings?: { skipDefeated?: boolean };
  /** Make this the active combat. */
  activate(): Promise<unknown>;
```

In `FoundryGame` add:

```ts
  /** The combat viewed by this client, or null. */
  readonly combat?: FoundryCombat | null;
  readonly keybindings: {
    register(namespace: string, action: string, data: object): void;
  };
```

In `TokenObject` add:

```ts
  readonly id: string;
  readonly document: FoundryTokenDocument;
```

Change the `canvas` declaration to:

```ts
declare const canvas: {
  scene?: { id: string } | null;
  tokens?: {
    get(id: string): TokenObject | undefined;
    readonly controlled?: TokenObject[];
  } | null;
  pan?(options: { x?: number; y?: number; scale?: number }): void;
};
```

Add `callback?: (event: Event, button: HTMLButtonElement, dialog: unknown) => unknown;` to `DialogV2Button`, and change `DialogV2Static.wait` to return `Promise<unknown>`. The one existing caller (`src/adapter/player-query.ts:61-72`) already passes the result to `toChoiceOrNull(value: unknown)`, so it needs no change.

- [ ] **Step 2: Add constants and i18n.** In `src/constants.ts` after `SETTINGS`:

```ts
/** Keybinding action ids. */
export const KEYBINDINGS = {
  /** GM: group the controlled tokens (default G). */
  GROUP_SELECTED: "groupSelected"
} as const;
```

In `lang/en.json`: delete `"TACTICAL_INITIATIVE.Group.AddTo"` and `"TACTICAL_INITIATIVE.Group.DefaultName"`; add:

```json
  "TACTICAL_INITIATIVE.Group.FallbackName": "Group",
  "TACTICAL_INITIATIVE.Grouping.HudButton": "Group selected tokens",
  "TACTICAL_INITIATIVE.Grouping.KeyName": "Group selected tokens",
  "TACTICAL_INITIATIVE.Grouping.KeyHint": "Adds the selected tokens to combat and to a group (new or existing).",
  "TACTICAL_INITIATIVE.Grouping.NothingSelected": "Select one or more tokens first.",
  "TACTICAL_INITIATIVE.Grouping.NoScene": "Open a scene before grouping tokens.",
  "TACTICAL_INITIATIVE.Grouping.DialogTitle": "Group tokens",
  "TACTICAL_INITIATIVE.Grouping.NameLabel": "New group name",
  "TACTICAL_INITIATIVE.Grouping.Existing": "Existing groups",
  "TACTICAL_INITIATIVE.Grouping.NewGroup": "New group",
  "TACTICAL_INITIATIVE.Grouping.Join": "Join {name}",
  "TACTICAL_INITIATIVE.Grouping.RemoveFromGroup": "Remove from group",
```

- [ ] **Step 3: Groups adapter.** In `src/adapter/groups.ts`: delete `addToGroup`, and change the `./boss-slots` import from `tearDownBossSlots` (only `addToGroup` used it) to `reconcileBossOnRetag`. Keep the `groupIdOf` import added in Task 1. In `removeFromGroup`, after the `updateEmbeddedDocuments` call, insert:

```ts
  // A boss leaving a group regains its double-turn slots.
  for (const id of combatantIds) {
    const combatant = combat.combatants.get(id);
    if (combatant) await reconcileBossOnRetag(combatant, combat);
  }
```

Append:

```ts
/**
 * Delete every group in the combat that has no members left (after a combatant
 * is deleted by F4 mob cleanup, a manual delete, or core token cleanup).
 *
 * @param combat - The combat.
 */
export async function sweepEmptyGroups(combat: FoundryCombat): Promise<void> {
  const used = new Set(combat.combatants.contents.map((c) => groupIdOf(c)));
  const empty = combat.groups.contents.filter((group) => !used.has(group.id)).map((group) => group.id);
  if (empty.length > 0) await combat.deleteEmbeddedDocuments("CombatantGroup", empty);
}
```

In `src/adapter/hooks.ts`, change the `deleteCombatant` body to:

```ts
    guard("deleteCombatant", async () => {
      await cleanupBossPairOnDelete(combatant, combat);
      await sweepEmptyGroups(combat);
    });
```

with `import { sweepEmptyGroups } from "./groups";`.

- [ ] **Step 4: Real port.** Create `src/adapter/grouping.ts`:

```ts
/**
 * @file The real {@link GroupingPort}: binds the battlemap Group Selected action
 * to Foundry combats, combatants, CombatantGroups, and a DialogV2 prompt. Foundry
 * boundary: not unit-tested (GroupingService is); README checklist covers it.
 */

import { FLAGS, MODULE_ID } from "../constants";
import type {
  GroupingCombatantRef,
  GroupingPort,
  GroupPromptRequest,
  GroupPromptResult
} from "../grouping-service";
import { groupIdOf, type GroupRef } from "../logic/group";
import { getPlayerTimeoutMs } from "../settings";
import { reconcileBossOnRetag, tearDownBossSlots } from "./boss-slots";
import { FoundryAdapter } from "./foundry-adapter";
import { DEFAULT_GROUP_COLOR, groupColor } from "./groups";

/** The Combat document class (subset) from CONFIG. */
function combatClass(): { create(data: object): Promise<FoundryCombat> } {
  return (CONFIG as unknown as { Combat: { documentClass: { create(data: object): Promise<FoundryCombat> } } })
    .Combat.documentClass;
}

/** Escape text for HTML content and attribute values. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Read the dialog's name input from a clicked button's form. */
function readName(button: HTMLButtonElement): string {
  const field = button.form?.elements.namedItem("name");
  return field instanceof HTMLInputElement ? field.value : "";
}

/** A {@link GroupingPort} bound to the viewed scene. */
export class FoundryGroupingPort implements GroupingPort {
  /** Resolve a combat by id or throw (ids come from resolveCombat). */
  private combat(combatId: string): FoundryCombat {
    const combat = game.combats?.get(combatId);
    if (!combat) throw new Error(`combat ${combatId} not found`);
    return combat;
  }

  public async resolveCombat(): Promise<string | null> {
    const sceneId = canvas.scene?.id ?? null;
    if (sceneId === null) return null;
    const viewed = game.combat ?? null;
    let combat: FoundryCombat | null =
      viewed && (viewed.scene === null || viewed.scene.id === sceneId) ? viewed : null;
    combat ??= game.combats?.find((c) => c.scene?.id === sceneId) ?? null;
    combat ??= await combatClass().create({ scene: sceneId, active: true });
    if (!combat.active) await combat.activate();
    return combat.id;
  }

  public listCombatants(combatId: string): GroupingCombatantRef[] {
    return this.combat(combatId).combatants.contents.map((c) => ({
      id: c.id,
      tokenId: c.tokenId,
      groupId: groupIdOf(c),
      initiative: c.initiative,
      bossEndSlot: c.getFlag(MODULE_ID, FLAGS.BOSS_SLOT) === "end"
    }));
  }

  public listGroups(combatId: string): GroupRef[] {
    return this.combat(combatId).groups.contents.map((g) => ({ id: g.id, name: g.name, color: groupColor(g) }));
  }

  public isStarted(combatId: string): boolean {
    return this.combat(combatId).started;
  }

  public tokenActorNames(tokenIds: readonly string[]): string[] {
    return tokenIds.map((id) => {
      const doc = canvas.tokens?.get(id)?.document;
      return doc?.actor?.name ?? doc?.name ?? "";
    });
  }

  public fallbackGroupName(): string {
    return game.i18n.localize("TACTICAL_INITIATIVE.Group.FallbackName");
  }

  public async createGroup(combatId: string, name: string): Promise<string> {
    const created = (await this.combat(combatId).createEmbeddedDocuments("CombatantGroup", [
      { name, flags: { [MODULE_ID]: { [FLAGS.GROUP_COLOR]: DEFAULT_GROUP_COLOR } } }
    ])) as unknown as FoundryCombatantGroup[];
    const group = created[0];
    if (!group) throw new Error("CombatantGroup was not created");
    return group.id;
  }

  public async createCombatants(
    combatId: string,
    tokenIds: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<string[]> {
    const sceneId = canvas.scene?.id ?? null;
    const data = tokenIds.flatMap((tokenId) => {
      const doc = canvas.tokens?.get(tokenId)?.document;
      if (!doc) return [];
      return [
        {
          tokenId,
          sceneId,
          actorId: doc.actorId,
          hidden: doc.hidden === true,
          group: groupId,
          ...(initiative !== null ? { initiative } : {})
        }
      ];
    });
    if (data.length === 0) return [];
    const created = await this.combat(combatId).createEmbeddedDocuments("Combatant", data);
    return created.map((c) => c.id);
  }

  public async assign(
    combatId: string,
    ids: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<void> {
    await this.combat(combatId).updateEmbeddedDocuments(
      "Combatant",
      ids.map((id) => ({ _id: id, group: groupId, ...(initiative !== null ? { initiative } : {}) }))
    );
  }

  public async unassign(combatId: string, ids: readonly string[]): Promise<void> {
    await this.combat(combatId).updateEmbeddedDocuments(
      "Combatant",
      ids.map((id) => ({ _id: id, group: null }))
    );
  }

  public async deleteGroup(combatId: string, groupId: string): Promise<void> {
    const combat = this.combat(combatId);
    if (combat.groups.get(groupId)) await combat.deleteEmbeddedDocuments("CombatantGroup", [groupId]);
  }

  public async rollGroupInitiative(combatId: string, groupId: string): Promise<number | null> {
    const combat = this.combat(combatId);
    const hasMember = combat.combatants.contents.some((c) => groupIdOf(c) === groupId);
    if (!hasMember) return null;
    return new FoundryAdapter(combat, getPlayerTimeoutMs()).rollGroupInitiative(groupId);
  }

  public async setInitiative(combatId: string, ids: readonly string[], value: number): Promise<void> {
    await this.combat(combatId).updateEmbeddedDocuments(
      "Combatant",
      ids.map((id) => ({ _id: id, initiative: value }))
    );
  }

  public async tearDownBoss(combatId: string, ids: readonly string[]): Promise<void> {
    const combat = this.combat(combatId);
    for (const id of ids) {
      const combatant = combat.combatants.get(id);
      if (combatant) await tearDownBossSlots(combatant, combat);
    }
  }

  public async reconcileBoss(combatId: string, ids: readonly string[]): Promise<void> {
    const combat = this.combat(combatId);
    for (const id of ids) {
      const combatant = combat.combatants.get(id);
      if (combatant) await reconcileBossOnRetag(combatant, combat);
    }
  }

  public async prompt(request: GroupPromptRequest): Promise<GroupPromptResult> {
    const legend = request.options
      .map(
        (g) =>
          `<li><span style="display:inline-block;width:0.8em;height:0.8em;border-radius:50%;background:${escapeHtml(
            g.color ?? DEFAULT_GROUP_COLOR
          )}"></span> ${escapeHtml(g.name)}</li>`
      )
      .join("");
    const content =
      `<label>${escapeHtml(game.i18n.localize("TACTICAL_INITIATIVE.Grouping.NameLabel"))}` +
      ` <input type="text" name="name" value="${escapeHtml(request.defaultName)}" autofocus></label>` +
      `<p>${escapeHtml(game.i18n.localize("TACTICAL_INITIATIVE.Grouping.Existing"))}</p><ul>${legend}</ul>`;
    const buttons: DialogV2Button[] = [
      {
        action: "new",
        label: game.i18n.localize("TACTICAL_INITIATIVE.Grouping.NewGroup"),
        default: true,
        callback: (_event, button) => ({ action: "new", name: readName(button) })
      },
      ...request.options.map(
        (g): DialogV2Button => ({
          action: `join-${g.id}`,
          label: game.i18n.format("TACTICAL_INITIATIVE.Grouping.Join", { name: g.name }),
          callback: () => ({ action: "join", groupId: g.id })
        })
      )
    ];
    if (request.offerRemove) {
      buttons.push({
        action: "remove",
        label: game.i18n.localize("TACTICAL_INITIATIVE.Grouping.RemoveFromGroup"),
        callback: () => ({ action: "remove" })
      });
    }
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("TACTICAL_INITIATIVE.Grouping.DialogTitle") },
      content,
      buttons,
      rejectClose: false,
      modal: true
    });
    return result && typeof result === "object" && "action" in result ? (result as GroupPromptResult) : null;
  }

  public warn(key: "NothingSelected" | "NoScene"): void {
    ui.notifications?.warn(game.i18n.localize(`TACTICAL_INITIATIVE.Grouping.${key}`));
  }
}
```

- [ ] **Step 5: Entry points.** Create `src/adapter/grouping-ui.ts`:

```ts
/**
 * @file Battlemap entry points for grouping: a Token HUD button and the `G`
 * keybinding (GM only), both running {@link GroupingService} over the real port.
 * Foundry boundary: not unit-tested; README checklist.
 */

import { KEYBINDINGS, MODULE_ID } from "../constants";
import { GroupingService } from "../grouping-service";
import { runSafe } from "../ui/run-safe";
import { FoundryGroupingPort } from "./grouping";

/**
 * Group the controlled tokens plus an optional extra token (the HUD's token).
 *
 * @param extraTokenId - A token to include even if it is not controlled.
 */
export async function groupSelectedTokens(extraTokenId?: string): Promise<void> {
  if (game.user?.isGM !== true) return;
  const ids = (canvas.tokens?.controlled ?? []).map((token) => token.id);
  if (extraTokenId) ids.push(extraTokenId);
  await new GroupingService(new FoundryGroupingPort()).groupSelected(ids);
}

/** Register the GM-only "Group selected tokens" keybinding (call at `init`). */
export function registerGroupingKeybinding(): void {
  game.keybindings.register(MODULE_ID, KEYBINDINGS.GROUP_SELECTED, {
    name: "TACTICAL_INITIATIVE.Grouping.KeyName",
    hint: "TACTICAL_INITIATIVE.Grouping.KeyHint",
    editable: [{ key: "KeyG" }],
    restricted: true,
    onDown: (): boolean => {
      void runSafe("group selected", () => groupSelectedTokens());
      return true;
    }
  });
}

/** Add the group button to the Token HUD's left column (GM only, once per render). */
export function registerTokenHudButton(): void {
  Hooks.on("renderTokenHUD", (app: unknown, html: unknown): void => {
    if (game.user?.isGM !== true) return;
    const root = html instanceof HTMLElement ? html : (html as { 0?: unknown } | null)?.[0];
    if (!(root instanceof HTMLElement)) return;
    const column = root.querySelector<HTMLElement>(".col.left");
    if (!column || column.querySelector(`.${MODULE_ID}-group-btn`)) return;
    const tokenId = (app as { object?: { id?: string } }).object?.id;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `control-icon ${MODULE_ID}-group-btn`;
    button.title = game.i18n.localize("TACTICAL_INITIATIVE.Grouping.HudButton");
    const icon = document.createElement("i");
    icon.className = "fas fa-object-group";
    button.appendChild(icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void runSafe("group selected", () => groupSelectedTokens(tokenId));
    });
    column.appendChild(button);
  });
}
```

- [ ] **Step 6: Group UI cleanup.** In `src/adapter/group-ui.ts`:
  1. Delete `selectedCombatantIds`, `addSelectionToNewGroup`, `decorateTrackerGroups`, the "Add to group" `options.push`, and the `renderCombatTracker` hook in `registerGroupUI`. Remove `addToGroup` from the import list.
  2. Update the file-header comment to drop "add the ctrl-selected rows" and "colored group tag rendered on each grouped row"; say group rows in the sidebar are rendered by dnd5e.
  3. Add these exports (and make `renameClickedGroup`/`recolorClickedGroup` call them):

```ts
/**
 * Prompt for and apply a new group name.
 *
 * @param combat - The combat.
 * @param groupId - The group id.
 */
export async function renameGroupInteractive(combat: FoundryCombat, groupId: string): Promise<void> {
  const current = combat.groups.get(groupId)?.name ?? "";
  const name = await promptForText("TACTICAL_INITIATIVE.Group.Rename", current);
  if (name !== null && name.length > 0) await renameGroup(combat, groupId, name);
}

/**
 * Prompt for and apply a new group color.
 *
 * @param combat - The combat.
 * @param groupId - The group id.
 */
export async function recolorGroupInteractive(combat: FoundryCombat, groupId: string): Promise<void> {
  const group = combat.groups.get(groupId);
  const color = await promptForColor(group ? groupColor(group) : DEFAULT_GROUP_COLOR);
  if (color !== null && color.length > 0) await recolorGroup(combat, groupId, color);
}
```

```ts
async function renameClickedGroup(target: unknown): Promise<void> {
  const id = combatantIdFromTarget(target);
  const groupId = clickedGroupId(target);
  const location = id ? findCombatant(id) : null;
  if (location && groupId) await renameGroupInteractive(location.combat, groupId);
}

async function recolorClickedGroup(target: unknown): Promise<void> {
  const id = combatantIdFromTarget(target);
  const groupId = clickedGroupId(target);
  const location = id ? findCombatant(id) : null;
  if (location && groupId) await recolorGroupInteractive(location.combat, groupId);
}
```

  4. Replace each `void someAsync(target);` callback body in `pushGroupOptions` with `void runSafe("<label>", () => someAsync(target));` (labels: `remove from group`, `rename group`, `recolor group`, `disband group`), importing `runSafe` from `"../ui/run-safe"`.

Run: `grep -n "AddTo\|addToGroup\|selectedCombatantIds\|decorateTrackerGroups" -r src lang`
Expected: no output.

- [ ] **Step 7: Register at init.** In `src/main.ts` add `import { registerGroupingKeybinding, registerTokenHudButton } from "./adapter/grouping-ui";` and call both inside the `init` hook after `registerGroupUI();`.

- [ ] **Step 8: Full check + commit**

Run: `npm run check`
Expected: green; existing tests unchanged.

```bash
git add src lang scripts/main.js scripts/main.js.map
git commit -m "feat: group selected tokens from the Token HUD or the G key"
```

---

### Task 7: One turn per group (adapter)

**Files:**
- Create: `src/adapter/group-turns.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `adjustTurn`, `groupTieBreak`, `TurnRef` (Task 2); `groupIdOf` (Task 1); `guard` from `src/adapter/hooks.ts`.
- Produces: `registerGroupTurns(): void`

- [ ] **Step 1: Implement.** Create `src/adapter/group-turns.ts`:

```ts
/**
 * @file Makes a combatant group take one turn: a preUpdateCombat hook rewrites
 * the pending turn with the pure adjustTurn rule, and a sort tie-break keeps a
 * group's members adjacent. Works for any tracker that advances turns through
 * Combat#nextTurn / #previousTurn / update({turn}). Foundry boundary: the rules
 * are tested in test/turns.test.ts; this wiring is on the README checklist.
 */

import { MODULE_ID } from "../constants";
import { groupIdOf } from "../logic/group";
import { adjustTurn, groupTieBreak, type TurnRef } from "../logic/turns";
import { guard } from "./hooks";

/** Marker so the sort method is wrapped once. */
const SORT_PATCHED = "__tacticalInitiativeGroupSortPatched";

/** Wrap Combat#_sortCombatants with the group tie-break (best effort). */
function patchSort(): void {
  const proto = (CONFIG as unknown as { Combat?: { documentClass?: { prototype?: Record<string, unknown> } } })
    .Combat?.documentClass?.prototype;
  if (!proto || proto[SORT_PATCHED] === true) return;
  const original = proto["_sortCombatants"];
  if (typeof original !== "function") {
    console.warn(`${MODULE_ID} | Combat#_sortCombatants not found; group members may interleave on ties`);
    return;
  }
  const sort = original as (this: unknown, a: FoundryCombatant, b: FoundryCombatant) => number;
  proto["_sortCombatants"] = function (this: unknown, a: FoundryCombatant, b: FoundryCombatant): number {
    const tie = groupTieBreak(
      { initiative: a.initiative, groupId: groupIdOf(a) },
      { initiative: b.initiative, groupId: groupIdOf(b) }
    );
    return tie !== 0 ? tie : sort.call(this, a, b);
  };
  proto[SORT_PATCHED] = true;
}

/** Register the turn-skip hook and the sort tie-break. Call at `init`. */
export function registerGroupTurns(): void {
  Hooks.once("setup", patchSort);
  Hooks.on(
    "preUpdateCombat",
    (combat: FoundryCombat, changes: { turn?: unknown; round?: unknown }, options: { direction?: number }): boolean | void => {
      if (typeof changes.turn !== "number") return;
      if (typeof changes.round === "number" && changes.round > combat.round) return;
      const from = combat.turn;
      const direction: 1 | -1 =
        options.direction === -1 || options.direction === 1
          ? options.direction
          : changes.turn < (from ?? -1)
            ? -1
            : 1;
      const turns: TurnRef[] = combat.turns.map((c) => ({
        id: c.id,
        groupId: groupIdOf(c),
        defeated: c.isDefeated
      }));
      const result = adjustTurn(turns, from, changes.turn, direction, combat.settings?.skipDefeated === true);
      if (result.kind === "set") changes.turn = result.turn;
      if (result.kind === "nextRound") {
        guard("group next round", async () => {
          await combat.nextRound();
        });
        return false;
      }
    }
  );
}
```

- [ ] **Step 2: Register.** In `src/main.ts` import `registerGroupTurns` from `"./adapter/group-turns"` and call it in `init` after `registerHooks();`.

- [ ] **Step 3: Full check + commit**

Run: `npm run check`
Expected: green.

```bash
git add src scripts/main.js scripts/main.js.map
git commit -m "feat: a combatant group takes one turn (skip members, keep them adjacent)"
```

---

### Task 8: Top-bar group cell, member popover, group menu, README

**Files:**
- Modify: `src/adapter/top-bar.ts` (group branch of `renderRow`, popover, group menu, `render`)
- Modify: `styles/tactical-initiative.css` (append group-cell rules)
- Modify: `README.md:239-317`
- Modify: `FUTURE_WORK.md`

**Interfaces:**
- Consumes: group `TrackerRow` fields `portraits`, `members`, `living`, `memberCount` (Task 3); `openUiMenu`, `MenuItem` (Task 5); `renameGroupInteractive`, `recolorGroupInteractive` (Task 6); `openGroupHud`, `disbandGroup` (existing).

- [ ] **Step 1: Group menu + expand state.** In `src/adapter/top-bar.ts`, extend the existing `./groups` import to `import { disbandGroup, groupColor } from "./groups";`, add `import { recolorGroupInteractive, renameGroupInteractive } from "./group-ui";`. Below `openCombatantMenu` add:

```ts
/** Group ids whose member popover is open; survives redraws. */
const expandedGroups = new Set<string>();

/** Popover element class. */
const POPOVER_CLASS = `${MODULE_ID}-tb-members`;

/**
 * Open the group-cell context menu (GM only): rename, recolor, HUD, disband.
 *
 * @param groupId - The group id.
 * @param x - Viewport x.
 * @param y - Viewport y.
 */
function openGroupMenu(groupId: string, x: number, y: number): void {
  const combat = game.combats?.active ?? null;
  if (!combat || game.user?.isGM !== true) return;
  const items: MenuItem[] = [
    { label: game.i18n.localize("TACTICAL_INITIATIVE.Group.Rename"), run: () => renameGroupInteractive(combat, groupId) },
    { label: game.i18n.localize("TACTICAL_INITIATIVE.Group.Recolor"), run: () => recolorGroupInteractive(combat, groupId) },
    { label: game.i18n.localize("TACTICAL_INITIATIVE.HUD.Open"), run: () => openGroupHud(combat, groupId) },
    { label: game.i18n.localize("TACTICAL_INITIATIVE.Group.Disband"), run: () => disbandGroup(combat, groupId) }
  ];
  openUiMenu(document, MENU_ID, MENU_CLASS, items, x, y);
}

/**
 * Redraw member popovers for expanded groups, anchored under their cells.
 * Popovers live on document.body so the bar's scroll box cannot clip them.
 *
 * @param bar - The bar container.
 * @param rows - The rows just rendered.
 */
function renderPopovers(bar: HTMLElement, rows: readonly TrackerRow[]): void {
  document.querySelectorAll(`.${POPOVER_CLASS}`).forEach((el) => el.remove());
  const present = new Set(rows.flatMap((row) => (row.kind === "group" ? [row.groupId] : [])));
  for (const id of [...expandedGroups]) if (!present.has(id)) expandedGroups.delete(id);
  for (const row of rows) {
    if (row.kind !== "group" || !expandedGroups.has(row.groupId)) continue;
    const cell = bar.querySelector<HTMLElement>(`[data-group-id="${row.groupId}"]`);
    if (!cell) continue;
    const rect = cell.getBoundingClientRect();
    const pop = document.createElement("div");
    pop.className = POPOVER_CLASS;
    pop.style.left = `${rect.left}px`;
    pop.style.top = `${rect.bottom + 4}px`;
    pop.style.borderColor = row.color;
    for (const member of row.members) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `${POPOVER_CLASS}-item`;
      if (member.defeated) button.classList.add(`${MODULE_ID}-tb-defeated`);
      if (member.img) {
        const img = document.createElement("img");
        img.src = member.img;
        img.alt = "";
        button.appendChild(img);
      }
      button.appendChild(document.createTextNode(member.name));
      button.addEventListener("click", () => {
        focusToken(member.id);
      });
      pop.appendChild(button);
    }
    document.body.appendChild(pop);
  }
}
```

- [ ] **Step 2: Group cell.** Replace the whole `else { ... }` (group) branch of `renderRow` with:

```ts
  } else {
    li.dataset["groupId"] = row.groupId;
    li.style.borderColor = row.color;
    const stack = document.createElement("div");
    stack.className = `${MODULE_ID}-tb-stack`;
    row.portraits.forEach((src, index) => {
      const face = document.createElement("div");
      face.className = `${MODULE_ID}-tb-stack-img`;
      face.style.backgroundImage = `url("${src}")`;
      face.style.setProperty("--ti-stack-i", String(index));
      stack.appendChild(face);
    });
    li.appendChild(stack);
    const badge = document.createElement("span");
    badge.className = `${MODULE_ID}-tb-count`;
    badge.textContent = row.living < row.memberCount ? `x${row.living}/${row.memberCount}` : `x${row.memberCount}`;
    li.appendChild(badge);
    const label = document.createElement("span");
    label.className = `${MODULE_ID}-tb-group-name`;
    label.textContent = row.name;
    li.appendChild(label);
    if (expandedGroups.has(row.groupId)) li.classList.add(`${MODULE_ID}-tb-expanded`);
    li.addEventListener("click", () => {
      if (expandedGroups.has(row.groupId)) expandedGroups.delete(row.groupId);
      else expandedGroups.add(row.groupId);
      render();
    });
    li.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openGroupMenu(row.groupId, event.clientX, event.clientY);
    });
    li.title = row.name;
  }
```

- [ ] **Step 3: Call popovers from `render`.** In `render()`, in the hidden branch add `document.querySelectorAll(`.${MODULE_ID}-tb-members`).forEach((el) => el.remove());` before `return;`. After `element.hidden = false;` add `renderPopovers(element, rows);`.

- [ ] **Step 4: CSS.** Append to `styles/tactical-initiative.css`:

```css
/* Top-bar group cell: stacked member portraits (map grouping, v1.5.0-rc2). */
.tactical-initiative-tb-group {
  background: rgba(0, 0, 0, 0.35);
}

.tactical-initiative-tb-stack {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 2px;
}

.tactical-initiative-tb-stack-img {
  position: absolute;
  width: 70%;
  height: 70%;
  left: calc(var(--ti-stack-i, 0) * 15%);
  top: calc(var(--ti-stack-i, 0) * 15%);
  background-size: cover;
  background-position: center;
  border: 1px solid rgba(0, 0, 0, 0.7);
  border-radius: 3px;
}

.tactical-initiative-tb-group-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: center;
  font-size: 9px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
}

.tactical-initiative-tb-expanded {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);
}

.tactical-initiative-tb-members {
  position: fixed;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 50vh;
  overflow-y: auto;
  padding: 0.2em;
  background: #1b1b1b;
  border: 2px solid #666;
  border-radius: 4px;
  pointer-events: all;
}

.tactical-initiative-tb-members-item {
  display: flex;
  align-items: center;
  gap: 0.4em;
  padding: 0.1em 0.4em;
  background: transparent;
  border: none;
  color: #eee;
  text-align: left;
  cursor: pointer;
}

.tactical-initiative-tb-members-item img {
  width: 24px;
  height: 24px;
  border: none;
  object-fit: cover;
}

.tactical-initiative-tb-members-item:hover {
  background: rgba(255, 255, 255, 0.12);
}
```

- [ ] **Step 5: README.** In `README.md`:
  1. In "Combatant groups checklist (B1a, v1.3.0)", prefix probe 1, probe 3, and check 5 with `**Superseded in v1.5.0-rc2 (map grouping).**` and leave their text.
  2. In "Top-bar tracker checklist (B2, v1.5.0)", change item 4 to: "**Groups.** Superseded in v1.5.0-rc2: see the map grouping checklist." and change item 7's parenthetical to "(tag as..., rename/recolor/disband, etc.)".
  3. Insert before `## Development`:

```markdown
## Map grouping checklist (v1.5.0-rc2, Plan A)

v14 + dnd5e 5.3 only. Run the P0 probe (spec) first.

1. **G with no combat.** On a scene with no combat, select 3 goblin tokens, press G. A
   combat is created and activated; one group "Goblin" holds all three; the top bar shows
   one stacked cell `x3`.
2. **HUD button.** Right-click a wolf token, click the group icon in the HUD's left column.
   A dialog offers a name (default "Wolf"), New group, and Join Goblin.
3. **Join mid-fight.** Start combat, then G a new goblin token and choose Join Goblin. It
   enters the combat with the group's initiative; no tag prompt; no extra turn.
4. **Boss in a selection.** Group a Boss-tagged token: no stray end slot appears. Remove it
   (HUD button -> Remove from group): its start/end double turn returns.
5. **Spot removal empties a group.** Remove the last member of a group: the group
   disappears from the top bar and the dnd5e sidebar.
6. **Dismiss.** Press G with groups present, close the dialog: nothing changes.
7. **Non-active GM.** With two GMs connected, the non-active GM presses G: grouping works.
8. **One turn per group.** Next Turn from a group moves past all its members; Previous Turn
   onto a group lands on its first member; Next Turn from the last group starts the next
   round. The dnd5e sidebar shows the group as one collapsible row.
9. **Group cell.** Click a group cell: a member list opens under it and stays open through
   an HP change; clicking a member pans to it. Right-click: Rename, Recolor, Open HUD,
   Disband all work. A defeated member dims in the list and the badge reads `x2/3`.
10. **Menus fire.** Right-click a combatant cell -> Tactical: tag as Boss applies the tag.
```

- [ ] **Step 6: FUTURE_WORK.** Append to `FUTURE_WORK.md`:

```markdown
- Sidebar group decoration was removed in v1.5.0-rc2: dnd5e 5.3 renders `CombatantGroup`s (2+
  members) as collapsible rows itself. Revisit only if a replacement tracker needs it.
```

- [ ] **Step 7: Full check + commit**

Run: `npm run check`
Expected: green.

```bash
git add src styles README.md FUTURE_WORK.md scripts/main.js scripts/main.js.map
git commit -m "feat: stacked-portrait group cell with member popover and group menu"
```

- [ ] **Step 8: Hand off for the live checklist.** Report to the DM: Plan A is ready for the "Map grouping checklist" in a live v14 world; Plan B (resize + leftover sweep) is next.
