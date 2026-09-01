# Combatant Groups B1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the GM group combatants so a group shares one initiative and shows a colored, renameable tag in the combat tracker, built on Foundry's native `CombatantGroup`.

**Architecture:** Membership uses the native `Combatant.group` id and a native `CombatantGroup` document; color is a module flag. The reroll cycle (`TacticalInitiative.rollForCombat`) is extended so each group rolls ONE initiative that all members take, and grouped combatants skip their per-tag path (no player prompt, no boss double-turn). Partition logic is pure/TDD; the reroll is tested against the fake port; group CRUD + tracker UI are the manual-checklist Foundry boundary.

**Tech Stack:** TypeScript (strictest), vitest, esbuild, Foundry v14 + dnd5e 5.3.

**Spec:** `docs/superpowers/specs/2026-08-31-combatant-groups-design.md`

## Global Constraints

- **Depends on workstream A** (PR #1). Execute after A merges; branch from the post-A `main`.
- Foundry **v14** + **dnd5e 5.3+** only.
- Strict TDD (superpowers:test-driven-development): no production logic without a failing test first. Foundry-coupled code goes behind a testable seam; only irreducible Foundry calls are untested (manual checklist).
- All group mutation runs on the elected active GM (`isActiveGM`), guard-wrapped.
- Full JSDoc on every export; ASCII-only; no placeholders.
- The HUD (four batch actions) is OUT of this plan - it is B1b.
- Commits require the user's per-commit approval; this project authorizes a `Co-Authored-By` trailer (no emoji).

---

### Task 1: `CombatantView.groupId` + pure `partitionByGroup`

**Files:**
- Modify: `src/types.ts` (add `groupId` to `CombatantView`)
- Create: `src/logic/group.ts`
- Test: `test/group.test.ts`

**Interfaces:**
- Produces: `CombatantView.groupId: string | null`; `interface GroupPartition { groups: { groupId: string; members: CombatantView[] }[]; ungrouped: CombatantView[] }`; `partitionByGroup(combatants: readonly CombatantView[]): GroupPartition`.

- [ ] **Step 1: Write the failing test**

Create `test/group.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { partitionByGroup } from "../src/logic/group";
import type { CombatantView } from "../src/types";

function view(id: string, groupId: string | null): CombatantView {
  return {
    id,
    actorId: `${id}-a`,
    actorName: id,
    tag: "mob",
    isDefeated: false,
    bossSlot: null,
    bossRank: null,
    groupId
  };
}

describe("partitionByGroup", () => {
  it("separates ungrouped combatants from groups", () => {
    const result = partitionByGroup([view("a", null), view("b", "g1"), view("c", "g1")]);
    expect(result.ungrouped.map((c) => c.id)).toEqual(["a"]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.groupId).toBe("g1");
    expect(result.groups[0]?.members.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("preserves group encounter order by first-seen member", () => {
    const result = partitionByGroup([view("a", "g2"), view("b", "g1"), view("c", "g2")]);
    expect(result.groups.map((g) => g.groupId)).toEqual(["g2", "g1"]);
  });

  it("returns no groups when nothing is grouped", () => {
    const result = partitionByGroup([view("a", null), view("b", null)]);
    expect(result.groups).toEqual([]);
    expect(result.ungrouped).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/group.test.ts`
Expected: FAIL (`Cannot find module '../src/logic/group'`).

- [ ] **Step 3: Add `groupId` to `CombatantView`**

In `src/types.ts`, inside `interface CombatantView`, after `bossRank`:

```ts
  /** The native CombatantGroup id this combatant belongs to, or `null`. */
  groupId: string | null;
```

- [ ] **Step 4: Write the minimal implementation**

Create `src/logic/group.ts`:

```ts
/**
 * @file Pure grouping logic: partition combatants into native groups and the
 * ungrouped remainder. No Foundry globals, no side effects.
 */

import type { CombatantView } from "../types";

/** A single group and its members, plus the ungrouped remainder. */
export interface GroupPartition {
  /** Groups in first-seen encounter order. */
  groups: { groupId: string; members: CombatantView[] }[];
  /** Combatants not in any group. */
  ungrouped: CombatantView[];
}

/**
 * Split combatants into groups (keyed by `groupId`) and the ungrouped remainder,
 * preserving encounter order by each group's first-seen member.
 *
 * @param combatants - The combatants to partition.
 * @returns The {@link GroupPartition}.
 */
export function partitionByGroup(combatants: readonly CombatantView[]): GroupPartition {
  const ungrouped: CombatantView[] = [];
  const groups: { groupId: string; members: CombatantView[] }[] = [];
  const byId = new Map<string, { groupId: string; members: CombatantView[] }>();
  for (const combatant of combatants) {
    if (combatant.groupId === null) {
      ungrouped.push(combatant);
      continue;
    }
    let group = byId.get(combatant.groupId);
    if (!group) {
      group = { groupId: combatant.groupId, members: [] };
      byId.set(combatant.groupId, group);
      groups.push(group);
    }
    group.members.push(combatant);
  }
  return { groups, ungrouped };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/group.test.ts`
Expected: PASS.

- [ ] **Step 6: Fix the fake-port fixture default**

`makeCombatant` in `test/fake-port.ts` must supply the new required field so existing service tests still typecheck. Add `groupId: null` to its defaults object (before `...over`):

```ts
    bossRank: null,
    rollValue: 10,
    groupId: null,
    ...over
```

- [ ] **Step 7: Run the full suite**

Run: `npm run check`
Expected: PASS (typecheck + all tests + build).

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/logic/group.ts test/group.test.ts test/fake-port.ts
git commit -m "feat: add groupId to CombatantView and pure partitionByGroup"
```

---

### Task 2: Group-aware reroll in `TacticalInitiative`

**Files:**
- Modify: `src/types.ts` (add `rollGroupInitiative` + `groupInitiativeValue` to `FoundryPort`)
- Modify: `src/service.ts` (`rollForCombat`, `rollForCombatant`)
- Modify: `test/fake-port.ts` (implement the two new port methods)
- Test: `test/service.test.ts` (new group cases)

**Interfaces:**
- Consumes: `partitionByGroup` (Task 1).
- Produces: `FoundryPort.rollGroupInitiative(groupId: string): Promise<number>` (roll one shared value for a group); `FoundryPort.groupInitiativeValue(groupId: string): Promise<number | null>` (a group's current shared value, for mid-round joins).

- [ ] **Step 1: Write the failing tests**

Add to `test/service.test.ts` (import `makeCombatant`, `FakePort` are already imported there):

```ts
describe("rollForCombat with groups", () => {
  it("gives every group member the group's single rolled initiative and skips their tag path", async () => {
    const port = new FakePort([
      makeCombatant({ id: "g-boss", tag: "boss", groupId: "grp", bossSlot: "start", bossRank: 0 }),
      makeCombatant({ id: "g-mob", tag: "mob", groupId: "grp", rollValue: 3 }),
      makeCombatant({ id: "solo", tag: "mob", rollValue: 7 })
    ]);
    port.groupRolls.set("grp", 15);

    await new TacticalInitiative(port).rollForCombat("c1");

    expect(port.initiatives.get("g-boss")).toBe(15);
    expect(port.initiatives.get("g-mob")).toBe(15);
    expect(port.initiatives.get("solo")).toBe(7);
    // Grouped boss did NOT get its slot value; grouped combatants were not per-tag rolled.
    expect(port.calls.filter((c) => c.method === "rollGroupInitiative")).toHaveLength(1);
  });

  it("does not prompt a grouped player", async () => {
    const port = new FakePort([
      makeCombatant({ id: "p", tag: "player", groupId: "grp" })
    ]);
    port.groupRolls.set("grp", 12);

    await new TacticalInitiative(port).rollForCombat("c1");

    expect(port.calls.some((c) => c.method === "requestPlayerChoice")).toBe(false);
    expect(port.initiatives.get("p")).toBe(12);
  });
});

describe("rollForCombatant joining a group mid-round", () => {
  it("takes the group's current shared initiative instead of rolling its tag", async () => {
    const port = new FakePort([makeCombatant({ id: "late", tag: "mob", groupId: "grp", rollValue: 99 })]);
    port.groupCurrent.set("grp", 8);

    await new TacticalInitiative(port).rollForCombatant("c1", "late");

    expect(port.initiatives.get("late")).toBe(8);
    expect(port.calls.some((c) => c.method === "rollInitiativeValue")).toBe(false);
  });
});
```

- [ ] **Step 2: Extend the fake port**

In `test/fake-port.ts`, add fields and methods to `FakePort`:

```ts
  /** Scripted per-group roll for rollGroupInitiative. */
  public readonly groupRolls = new Map<string, number>();
  /** Scripted per-group current value for groupInitiativeValue. */
  public readonly groupCurrent = new Map<string, number>();
```

```ts
  public async rollGroupInitiative(groupId: string): Promise<number> {
    this.record("rollGroupInitiative", groupId);
    return this.groupRolls.get(groupId) ?? 0;
  }

  public async groupInitiativeValue(groupId: string): Promise<number | null> {
    this.record("groupInitiativeValue", groupId);
    return this.groupCurrent.get(groupId) ?? null;
  }
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/service.test.ts`
Expected: FAIL (grouped members still routed through the tag path; `rollGroupInitiative` not called by the service; type errors on the new port methods until Step 4).

- [ ] **Step 4: Add the port methods to the interface**

In `src/types.ts`, inside `interface FoundryPort`:

```ts
  /**
   * Roll a single shared initiative value for a group (does not persist it).
   * @param groupId - The CombatantGroup id.
   */
  rollGroupInitiative(groupId: string): Promise<number>;

  /**
   * The group's current shared initiative, or `null` when unset. Used for a
   * combatant joining a group mid-round.
   * @param groupId - The CombatantGroup id.
   */
  groupInitiativeValue(groupId: string): Promise<number | null>;
```

- [ ] **Step 5: Make `rollForCombat` group-aware**

In `src/service.ts`, import the partition helper:

```ts
import { partitionByGroup } from "./logic/group";
```

Replace the body of `rollForCombat` after the reset pass:

```ts
    const active = combatants.filter((c) => !c.isDefeated);
    const { groups, ungrouped } = partitionByGroup(active);

    // Ungrouped: normal per-tag behavior.
    const choices = await this.gatherPlayerChoices(ungrouped);
    for (const combatant of ungrouped) {
      await this.applyCombatant(combatant, choices.get(combatant.id));
    }

    // Groups: one roll each; every member takes it (grouping overrides tags).
    for (const group of groups) {
      const value = await this.port.rollGroupInitiative(group.groupId);
      for (const member of group.members) {
        await this.port.setInitiative(member.id, value);
      }
    }
```

- [ ] **Step 6: Make `rollForCombatant` group-aware**

In `src/service.ts`, at the start of `rollForCombatant` after resolving `combatant`:

```ts
    if (!combatant || combatant.isDefeated) return;
    if (combatant.groupId !== null) {
      const shared = await this.port.groupInitiativeValue(combatant.groupId);
      if (shared !== null) await this.port.setInitiative(combatant.id, shared);
      return;
    }
```

(Leave the existing ungrouped path below unchanged.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run test/service.test.ts`
Expected: PASS (new + existing service tests).

- [ ] **Step 8: Full check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/service.ts test/fake-port.ts test/service.test.ts
git commit -m "feat: group-aware reroll - shared initiative overrides tag path"
```

---

### Task 3: Real adapter - populate `groupId`, roll group initiative, skip boss slots

**Files:**
- Modify: `src/adapter/foundry-adapter.ts` (populate `groupId`; implement `rollGroupInitiative`, `groupInitiativeValue`)
- Modify: `src/adapter/boss-slots.ts` and/or `src/adapter/hooks.ts` (skip boss-slot creation for grouped combatants)
- Modify: `src/foundry-env.d.ts` (ambient: `FoundryCombatant.group`, `FoundryCombat.groups`, `FoundryCombatantGroup`)

**Interfaces:**
- Consumes: `FoundryPort` (Task 2).
- This is the Foundry boundary: no unit tests; verified by the manual checklist.

- [ ] **Step 1: Extend ambient types**

In `src/foundry-env.d.ts`, add to `FoundryCombatant`:

```ts
  /** The native CombatantGroup id, or null/empty when ungrouped. */
  readonly group?: string | null;
```

Add a `FoundryCombatantGroup` interface and a `groups` collection on `FoundryCombat`:

```ts
interface FoundryCombatantGroup {
  readonly id: string;
  readonly name: string;
  readonly initiative: number | null;
  getFlag(scope: string, key: string): unknown;
}
```

In `FoundryCombat`, add:

```ts
  readonly groups: FoundryCollection<FoundryCombatantGroup>;
```

- [ ] **Step 2: Populate `groupId` in `listCombatants`**

In `foundry-adapter.ts` `listCombatants`, add to the returned view object:

```ts
        groupId: typeof combatant.group === "string" && combatant.group ? combatant.group : null,
```

- [ ] **Step 3: Implement the two group port methods**

Add to `FoundryAdapter`:

```ts
  public async rollGroupInitiative(groupId: string): Promise<number> {
    // Roll once using a representative member so init bonuses apply, then share it.
    const member = this.combat.combatants.find(
      (c) => (typeof c.group === "string" ? c.group : null) === groupId
    );
    if (!member) return 0;
    const roll = this.buildInitiativeRoll(member);
    await roll.evaluate();
    return roll.total;
  }

  public async groupInitiativeValue(groupId: string): Promise<number | null> {
    const group = this.combat.groups.get(groupId);
    return group && typeof group.initiative === "number" ? group.initiative : null;
  }
```

(If probe #2 shows the native group's `initiative` is not kept in sync, fall back to reading any current member's `initiative`.)

- [ ] **Step 4: Skip boss slots for grouped combatants**

In `boss-slots.ts` `setupBossCombatant` (and the retag path), return early when the combatant is grouped:

```ts
  if (typeof combatant.group === "string" && combatant.group) return;
```

Add the same guard where `hooks.ts` `createCombatant` calls `setupBossCombatant`.

- [ ] **Step 5: Verify build**

Run: `npm run check`
Expected: PASS (typecheck + tests + build; adapter has no unit tests).

- [ ] **Step 6: Commit**

```bash
git add src/adapter/foundry-adapter.ts src/adapter/boss-slots.ts src/adapter/hooks.ts src/foundry-env.d.ts
git commit -m "feat: adapter group support - groupId, group roll, boss-slot skip"
```

---

### Task 4: Group management adapter (`groups.ts`) + color constant

**Files:**
- Create: `src/adapter/groups.ts`
- Modify: `src/constants.ts` (add `FLAGS.GROUP_COLOR`)
- Modify: `src/foundry-env.d.ts` (`FoundryCombat.createEmbeddedDocuments` already covers groups; add `updateEmbeddedDocuments`/`deleteEmbeddedDocuments` if absent)

**Interfaces:**
- Produces: `addToGroup(combat, combatantIds, groupId | null)`, `renameGroup`, `recolorGroup`, `removeFromGroup`, `disbandGroup` - all elected-GM-only, guard-wrapped. Foundry boundary; manual-checklist.

- [ ] **Step 1: Add the color flag key**

In `src/constants.ts` `FLAGS`, add:

```ts
  /** CombatantGroup flag: the tag color (a CSS hex string). */
  GROUP_COLOR: "color",
```

- [ ] **Step 2: Write the management helpers**

Create `src/adapter/groups.ts` with `addToGroup` (create a `CombatantGroup` when `groupId` is null via `combat.createEmbeddedDocuments("CombatantGroup", [{ name }])`, then set each combatant's `group`), `removeFromGroup` (clear `group`; disband when the group empties), `renameGroup`/`recolorGroup` (update the group's `name` / color flag), and `disbandGroup` (clear all members' `group`, then delete the group). Each guarded by `isActiveGM` and `guard`. Default name from `TACTICAL_INITIATIVE.Group.DefaultName`.

- [ ] **Step 3: Verify build**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/adapter/groups.ts src/constants.ts src/foundry-env.d.ts
git commit -m "feat: group management (create/assign/rename/recolor/remove/disband)"
```

---

### Task 5: Tracker UI - add-to-group + colored renameable tag

**Files:**
- Modify: `src/adapter/tagging-ui.ts` (or new `src/adapter/group-ui.ts`)
- Modify: `styles/tactical-initiative.css` (group tag color)
- Modify: `src/main.ts` (register group UI)

**Interfaces:** Foundry boundary; manual-checklist.

- [ ] **Step 1: Add-to-group control**

Add a combat-tracker context-menu entry (reusing the robust `_getEntryContextOptions`/`getCombatantContextOptions` approach already in `tagging-ui.ts`, so it works with replacement trackers): "Add to group" that reads the ctrl-selected combatant rows (the tracker's multi-select; the exact signal is probe #3) and calls `addToGroup`. Include "Remove from group", "Rename group", "Recolor group", "Disband group" where applicable.

- [ ] **Step 2: Render the colored, renameable tag**

On `renderCombatTracker`, for each group render its `name` as a tag on the group's row (or on member rows if the core tracker does not render group rows - probe #1), tinted with the `GROUP_COLOR` flag. Renaming edits the group `name`; recolor sets the flag. Wrap DOM work in try/catch (matches the existing choosing-indicator pattern).

- [ ] **Step 3: Register at init**

In `src/main.ts`, import and call the group-UI registration once in the `init` hook.

- [ ] **Step 4: Verify build**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapter/tagging-ui.ts src/adapter/group-ui.ts styles/tactical-initiative.css src/main.ts
git commit -m "feat: tracker add-to-group control and colored group tag"
```

---

### Task 6: i18n + version + README checklist

**Files:**
- Modify: `lang/en.json`
- Modify: `module.json`, `package.json` (version bump)
- Modify: `README.md`

- [ ] **Step 1: Add i18n keys**

Add to `lang/en.json`: `TACTICAL_INITIATIVE.Group.AddTo`, `.New`, `.Rename`, `.Recolor`, `.Remove`, `.Disband`, `.DefaultName` ("Group {n}").

- [ ] **Step 2: Version bump**

Set `module.json` and `package.json` `version` to `1.3.0`.

- [ ] **Step 3: README checklist**

Add a "Combatant groups (B1a)" section documenting the three probes (core tracker group rendering; dnd5e `rollInitiative` group interaction; the ctrl-select multi-select signal) first, then the behavior checks: ctrl-select -> add-to-group; grouped enemies share one initiative each round; grouped boss takes a single turn; colored renameable tag renders; disband restores individual behavior next round.

- [ ] **Step 4: Verify + commit (with bundle)**

Run: `npm run check`

```bash
git add lang/en.json module.json package.json README.md scripts/main.js scripts/main.js.map
git commit -m "chore: groups i18n, v1.3.0, and manual checklist"
```

---

## Live-world verification (probes first)

1. **Core tracker group rendering.** Does the v14 combat tracker render `CombatantGroup` rows natively? Style them if so; render our own group tag row if not.
2. **dnd5e group initiative.** Confirm dnd5e 5.3 `rollInitiative` does not fight the module setting each member's initiative explicitly; confirm the native group `initiative` field reflects the shared value (else read a member's initiative in `groupInitiativeValue`).
3. **Ctrl-select signal.** Determine how the tracker exposes a multi-selected set of combatant rows to a context action, and wire "Add to group" to it.
4. Grouped enemies share one initiative each round; a grouped boss takes a single turn; the colored renameable tag renders and edits; disband restores individual tag behavior on the next reroll.
