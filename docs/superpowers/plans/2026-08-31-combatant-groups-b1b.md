# Combatant Groups B1b (Control HUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-group control HUD, opened from the combat tracker, with four batch actions over every group member: select/move all tokens, target all, apply damage/healing to all, apply/remove a condition (or hidden/defeated) to all.

**Architecture:** All four actions are orchestrated by a pure-seam `GroupControlService` behind a `GroupControlPort`, unit-tested against an in-memory fake (mirroring `DeathService`/`DeathPort`). The real `GroupControlPort` (canvas selection/targeting, dnd5e `applyDamage`, status effects) and the ApplicationV2 panel are the untested Foundry boundary (manual checklist).

**Tech Stack:** TypeScript (strictest), vitest, esbuild, Foundry v14 + dnd5e 5.3.

**Spec:** `docs/superpowers/specs/2026-08-31-combatant-groups-design.md`

## Global Constraints

- **Depends on B1a** (groups + shared initiative). Execute after B1a lands.
- Foundry **v14** + **dnd5e 5.3+** only.
- Strict TDD: no production logic without a failing test first; Foundry-coupled code behind the testable port; only raw Foundry calls untested (manual checklist).
- All mutation is elected-GM-only, guard-wrapped. Full JSDoc; ASCII-only; no placeholders.
- Commits require the user's per-commit approval; this project authorizes a `Co-Authored-By` trailer (no emoji).

---

### Task 1: `GroupControlService` + `GroupControlPort` (TDD)

**Files:**
- Create: `src/group-control-service.ts`
- Test: `test/group-control-service.test.ts`
- Test: `test/fake-group-control-port.ts`

**Interfaces:**
- Produces: `interface GroupMemberRef { combatantId: string; tokenId: string | null; actorId: string; name: string }`; `interface DamageInput { amount: number; type?: string; isHealing?: boolean }`; `interface GroupControlPort`; `class GroupControlService` with `selectAll`, `targetAll`, `applyToAll`, `setConditionAll`.

- [ ] **Step 1: Write the fake port**

Create `test/fake-group-control-port.ts`:

```ts
import type {
  DamageInput,
  GroupControlPort,
  GroupMemberRef
} from "../src/group-control-service";

/** In-memory GroupControlPort recording each side effect for assertions. */
export class FakeGroupControlPort implements GroupControlPort {
  public membersByGroup = new Map<string, GroupMemberRef[]>();
  public selected: string[][] = [];
  public targeted: string[][] = [];
  public damaged: { actorId: string; input: DamageInput }[] = [];
  public conditions: { member: GroupMemberRef; statusId: string; active: boolean }[] = [];

  public members(groupId: string): GroupMemberRef[] {
    return this.membersByGroup.get(groupId) ?? [];
  }
  public async selectTokens(tokenIds: string[]): Promise<void> {
    this.selected.push(tokenIds);
  }
  public async targetTokens(tokenIds: string[]): Promise<void> {
    this.targeted.push(tokenIds);
  }
  public async applyDamage(actorId: string, input: DamageInput): Promise<void> {
    this.damaged.push({ actorId, input });
  }
  public async setCondition(member: GroupMemberRef, statusId: string, active: boolean): Promise<void> {
    this.conditions.push({ member, statusId, active });
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/group-control-service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { GroupControlService, type GroupMemberRef } from "../src/group-control-service";
import { FakeGroupControlPort } from "./fake-group-control-port";

const members: GroupMemberRef[] = [
  { combatantId: "c1", tokenId: "t1", actorId: "a1", name: "Gob 1" },
  { combatantId: "c2", tokenId: "t2", actorId: "a2", name: "Gob 2" },
  { combatantId: "c3", tokenId: null, actorId: "a3", name: "Gob 3" }
];

describe("GroupControlService", () => {
  let port: FakeGroupControlPort;
  let service: GroupControlService;

  beforeEach(() => {
    port = new FakeGroupControlPort();
    port.membersByGroup.set("g", members);
    service = new GroupControlService(port);
  });

  it("selects every member token, skipping members with no token", async () => {
    await service.selectAll("g");
    expect(port.selected).toEqual([["t1", "t2"]]);
  });

  it("targets every member token", async () => {
    await service.targetAll("g");
    expect(port.targeted).toEqual([["t1", "t2"]]);
  });

  it("applies damage/healing to every member actor", async () => {
    await service.applyToAll("g", { amount: 5, isHealing: false });
    expect(port.damaged.map((d) => d.actorId)).toEqual(["a1", "a2", "a3"]);
    expect(port.damaged[0]?.input.amount).toBe(5);
  });

  it("toggles a condition on every member", async () => {
    await service.setConditionAll("g", "prone", true);
    expect(port.conditions.map((c) => c.member.combatantId)).toEqual(["c1", "c2", "c3"]);
    expect(port.conditions.every((c) => c.statusId === "prone" && c.active)).toBe(true);
  });

  it("no-ops on an empty or unknown group", async () => {
    await service.selectAll("missing");
    await service.applyToAll("missing", { amount: 5 });
    expect(port.selected).toEqual([[]]);
    expect(port.damaged).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/group-control-service.test.ts`
Expected: FAIL (`Cannot find module '../src/group-control-service'`).

- [ ] **Step 4: Write the minimal implementation**

Create `src/group-control-service.ts`:

```ts
/**
 * @file The group control HUD's batch actions, orchestrated behind the
 * {@link GroupControlPort} seam so the flow is unit-tested against a fake. The
 * real Foundry binding (canvas selection, targeting, dnd5e applyDamage, status
 * effects) lives in the adapter.
 */

/** A group member reduced to what the batch actions need. */
export interface GroupMemberRef {
  /** The combatant document id. */
  combatantId: string;
  /** The token document id, or `null` when the member has no scene token. */
  tokenId: string | null;
  /** The actor id. */
  actorId: string;
  /** Display name. */
  name: string;
}

/** Damage or healing to apply to a member. */
export interface DamageInput {
  /** The amount (always positive; `isHealing` sets direction). */
  amount: number;
  /** The dnd5e damage type, if any. */
  type?: string;
  /** When true, heal instead of damage. */
  isHealing?: boolean;
}

/** The seam between {@link GroupControlService} and Foundry. */
export interface GroupControlPort {
  /** The group's current members. */
  members(groupId: string): GroupMemberRef[];
  /** Select the given tokens on the canvas. */
  selectTokens(tokenIds: string[]): Promise<void>;
  /** Set the given tokens as the user's targets. */
  targetTokens(tokenIds: string[]): Promise<void>;
  /** Apply damage or healing to an actor (respecting its resistances). */
  applyDamage(actorId: string, input: DamageInput): Promise<void>;
  /** Toggle a status/condition on a member. */
  setCondition(member: GroupMemberRef, statusId: string, active: boolean): Promise<void>;
}

/** Runs the HUD's four batch actions over a group's members. */
export class GroupControlService {
  /**
   * @param port - The Foundry seam.
   */
  public constructor(private readonly port: GroupControlPort) {}

  /**
   * Select every member token on the canvas (members without a token are skipped).
   *
   * @param groupId - The group id.
   */
  public async selectAll(groupId: string): Promise<void> {
    await this.port.selectTokens(this.tokenIds(groupId));
  }

  /**
   * Target every member token.
   *
   * @param groupId - The group id.
   */
  public async targetAll(groupId: string): Promise<void> {
    await this.port.targetTokens(this.tokenIds(groupId));
  }

  /**
   * Apply damage or healing to every member actor.
   *
   * @param groupId - The group id.
   * @param input - The damage/healing to apply.
   */
  public async applyToAll(groupId: string, input: DamageInput): Promise<void> {
    for (const member of this.port.members(groupId)) {
      await this.port.applyDamage(member.actorId, input);
    }
  }

  /**
   * Toggle a condition on every member.
   *
   * @param groupId - The group id.
   * @param statusId - The dnd5e status/condition id.
   * @param active - Whether to add (`true`) or remove (`false`) it.
   */
  public async setConditionAll(groupId: string, statusId: string, active: boolean): Promise<void> {
    for (const member of this.port.members(groupId)) {
      await this.port.setCondition(member, statusId, active);
    }
  }

  /** Token ids of members that have a token. */
  private tokenIds(groupId: string): string[] {
    return this.port
      .members(groupId)
      .map((member) => member.tokenId)
      .filter((id): id is string => id !== null);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/group-control-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Full check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/group-control-service.ts test/group-control-service.test.ts test/fake-group-control-port.ts
git commit -m "feat: add GroupControlService + GroupControlPort for HUD batch actions (TDD)"
```

---

### Task 2: Real `GroupControlPort` adapter

**Files:**
- Create: `src/adapter/group-control.ts`
- Modify: `src/foundry-env.d.ts` (ambient: `canvas.tokens`, token `control`/`setTarget`, `actor.applyDamage`, `token.toggleStatusEffect` or `actor.toggleStatusEffect`)

**Interfaces:**
- Consumes: `GroupControlPort` (Task 1). Foundry boundary; no unit tests; manual checklist.

- [ ] **Step 1: Extend ambient types**

Add the minimal members the adapter uses: `canvas.tokens.get(id)`, `TokenObject.control({ releaseOthers })`, `TokenObject.setTarget(active, { releaseOthers })`, `FoundryActor.applyDamage(amount, options)`, and a status-toggle method (`actor.toggleStatusEffect(statusId, { active })` in dnd5e/v14). Keep each declaration narrow.

- [ ] **Step 2: Implement the port**

Create `src/adapter/group-control.ts` implementing `GroupControlPort` against a bound combat/group: `members` reads the group's combatants into `GroupMemberRef`s; `selectTokens` controls the placeables (`releaseOthers` on the first, additive after); `targetTokens` calls `setTarget`; `applyDamage` calls each actor's dnd5e `applyDamage` (healing = negative multiplier per dnd5e); `setCondition` toggles the status effect. Guard mutations with `isActiveGM`.

- [ ] **Step 3: Verify build**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/adapter/group-control.ts src/foundry-env.d.ts
git commit -m "feat: real GroupControlPort adapter (select/target/damage/condition)"
```

---

### Task 3: The HUD panel + open-from-tracker control

**Files:**
- Create: `src/adapter/group-hud.ts`
- Modify: `src/adapter/group-ui.ts` (add the "Open group HUD" control from B1a's tracker menu)
- Modify: `styles/tactical-initiative.css`
- Modify: `src/main.ts` (register)

**Interfaces:** Foundry boundary; manual-checklist.

- [ ] **Step 1: Build the ApplicationV2 panel**

Create `src/adapter/group-hud.ts`: an ApplicationV2 (pop-out, movable/resizable per v14) showing the group's members (name + HP bar) and four buttons wired to a `GroupControlService` over the real `GroupControlPort`. The damage button opens a small amount+type prompt (reuse DialogV2); the condition button opens a status picker. GM-only.

- [ ] **Step 2: Open control from the tracker**

In `group-ui.ts` (from B1a), add an "Open group HUD" entry on the group's tracker row that constructs and renders the HUD for that group.

- [ ] **Step 3: Register + style**

Register any needed hook in `main.ts`; add HUD styles.

- [ ] **Step 4: Verify build**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapter/group-hud.ts src/adapter/group-ui.ts styles/tactical-initiative.css src/main.ts
git commit -m "feat: group control HUD panel with four batch actions"
```

---

### Task 4: i18n + version + README checklist

**Files:**
- Modify: `lang/en.json`, `module.json`, `package.json`, `README.md`

- [ ] **Step 1: i18n**

Add `TACTICAL_INITIATIVE.HUD.Title` / `.SelectAll` / `.TargetAll` / `.ApplyDamage` / `.Condition` (and the damage/condition dialog strings).

- [ ] **Step 2: Version bump**

Set `module.json` and `package.json` `version` to `1.4.0`.

- [ ] **Step 3: README checklist**

Add a "Group control HUD (B1b)" section: open the HUD from a group's tracker row; each of the four actions affects every member (select all, target all, apply damage/healing to all respecting resistances, toggle a condition on all); a member without a token is skipped by select/target but still takes damage/conditions via its actor.

- [ ] **Step 4: Verify + commit (with bundle)**

Run: `npm run check`

```bash
git add lang/en.json module.json package.json README.md scripts/main.js scripts/main.js.map
git commit -m "chore: HUD i18n, v1.4.0, and manual checklist"
```

---

## Live-world verification

1. Open the HUD from a group row; it pops out, is movable/resizable, and lists members with live HP.
2. Select all -> every member token is controlled on the canvas (move them together).
3. Target all -> every member token becomes a target.
4. Apply 10 slashing to all -> each member takes 10 through dnd5e `applyDamage` (resistances/immunities respected); healing path restores HP.
5. Toggle "prone" on all -> the status appears on every member; toggling again removes it.
6. A member with no scene token is skipped by select/target but still receives damage and conditions via its actor.
