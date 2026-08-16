# Tactical Initiative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an installable FoundryVTT v13 + dnd5e module that replaces initiative with tag-based (Player / Boss / Mob) behavior, rerolled at combat start and each round.

**Architecture:** Three layers - pure logic (`src/logic/`), an orchestration service depending only on a `FoundryPort` interface (`src/service.ts`), and a thin real-Foundry adapter + hook wiring (`src/adapter/`, `src/main.ts`). Pure logic and the service are TDD'd with vitest against an in-memory fake port; the adapter is covered by a manual checklist.

**Tech Stack:** TypeScript (strictest tsconfig), vitest, esbuild bundle -> `scripts/main.js`.

## Global Constraints

- FoundryVTT v13; no APIs deprecated in v13.
- D&D 5e system `dnd5e`, compatibility floor 4.0.0.
- All roll logic runs on the active GM only; players only answer the dialog.
- ASCII-only text, no emoji, in all authored files.
- Full JSDoc on every export. Strictest TypeScript; no `any` leaking into logic.
- No placeholders or stubs in shipped code.
- Uncertain v13/dnd5e signatures: pick the likeliest current one, log it in README assumptions.

## File structure

- `src/constants.ts` - unions, flag keys, data maps (written).
- `src/types.ts` - `EffectChange`, `CombatantView`, `FoundryPort`.
- `src/logic/tag.ts` - `resolveTag`.
- `src/logic/initiative.ts` - `initiativeAdjustment`, `normalizeChoice`.
- `src/logic/effects.ts` - `effectChangesFor`.
- `src/logic/boss.ts` - `bossSlotInitiative`.
- `src/service.ts` - `TacticalInitiative` (`rollForCombat`, `rollForCombatant`).
- `src/adapter/foundry-adapter.ts` - real `FoundryPort` impl.
- `src/adapter/hooks.ts`, `src/adapter/tagging-ui.ts`, `src/adapter/player-query.ts`, `src/adapter/boss-slots.ts` - wiring.
- `src/settings.ts` - settings registration.
- `src/main.ts` - entry.
- `test/*.test.ts` - unit tests; `test/fake-port.ts` - in-memory fake.

---

### Task 1: Pure logic - `resolveTag`

**Files:** Create `src/logic/tag.ts`; Test `test/tag.test.ts`.

**Interfaces:**
- Produces: `resolveTag(actorType: string, storedTag: string | null | undefined): Tag`.

- [ ] **Step 1: failing tests**
```ts
import { describe, expect, it } from "vitest";
import { resolveTag } from "../src/logic/tag.js";

describe("resolveTag", () => {
  it("returns the stored tag when valid", () => {
    expect(resolveTag("npc", "boss")).toBe("boss");
  });
  it("defaults character actors to player", () => {
    expect(resolveTag("character", null)).toBe("player");
  });
  it("defaults non-character actors to mob", () => {
    expect(resolveTag("npc", undefined)).toBe("mob");
  });
  it("ignores an invalid stored tag and falls back by type", () => {
    expect(resolveTag("character", "garbage")).toBe("player");
  });
});
```
- [ ] **Step 2:** `npx vitest run test/tag.test.ts` - expect FAIL (module missing).
- [ ] **Step 3:** implement `resolveTag` (stored-if-valid else type default).
- [ ] **Step 4:** rerun - expect PASS.

### Task 2: Pure logic - `initiativeAdjustment`, `normalizeChoice`

**Files:** Create `src/logic/initiative.ts`; Test `test/initiative-logic.test.ts`.

**Interfaces:**
- Produces: `initiativeAdjustment(choice: Choice): number`; `normalizeChoice(raw: unknown): Choice`.

- [ ] **Step 1: failing tests** - rush 3 / march 0 / hunker -6; `normalizeChoice` passes valid through and maps invalid/undefined to `"march"`.
- [ ] **Step 2:** run - FAIL.
- [ ] **Step 3:** implement reading `CHOICE_INIT_ADJUST`; `normalizeChoice` checks membership in `CHOICES`.
- [ ] **Step 4:** run - PASS.

### Task 3: Pure logic - `effectChangesFor`

**Files:** Create `src/logic/effects.ts`; Test `test/effects-logic.test.ts`.

**Interfaces:**
- Produces: `effectChangesFor(choice: Choice): EffectChange[]`.

- [ ] **Step 1: failing tests** - `march -> []`; `rush` -> one change per `DND5E_BONUS_KEYS`, all `value: "-1"`, `mode: 2`; `hunker` -> all `value: "+2"`, `mode: 2`; length equals `DND5E_BONUS_KEYS.length`.
- [ ] **Step 2:** run - FAIL.
- [ ] **Step 3:** implement using `CHOICE_EFFECT_MODIFIER` (0 -> empty) and `DND5E_BONUS_KEYS`; format value with explicit sign.
- [ ] **Step 4:** run - PASS.

### Task 4: Pure logic - `bossSlotInitiative`

**Files:** Create `src/logic/boss.ts`; Test `test/boss-logic.test.ts`.

**Interfaces:**
- Produces: `bossSlotInitiative(slot: BossSlot, rank: number): number`.

- [ ] **Step 1: failing tests** - `start,0 -> 10000`; `end,0 -> -10000`; rank raises priority: `start,0 > start,1`; ordering preserved at end: `end,0 > end,1`; every start `> 1000` and every end `< -1000`.
- [ ] **Step 2:** run - FAIL.
- [ ] **Step 3:** implement `start: BASE - rank`, `end: -BASE - rank`.
- [ ] **Step 4:** run - PASS.

### Task 5: Port + types (scaffolding, no behavior)

**Files:** Create `src/types.ts`.

**Interfaces:**
- Produces: `EffectChange`, `CombatantView`, `FoundryPort` (signatures per spec).

- [ ] **Step 1:** write the interfaces with full JSDoc. No test (declarations only).
- [ ] **Step 2:** `npm run typecheck` - expect PASS.

### Task 6: Service - `rollForCombat` / `rollForCombatant`

**Files:** Create `src/service.ts`; Test `test/service.test.ts`; Test util `test/fake-port.ts`.

**Interfaces:**
- Consumes: `FoundryPort`, all pure logic.
- Produces: `class TacticalInitiative { constructor(port: FoundryPort); rollForCombat(combatId: string): Promise<void>; rollForCombatant(combatId: string, combatantId: string): Promise<void>; }`.

- [ ] **Step 1: fake port** - `test/fake-port.ts`: in-memory `FoundryPort` recording calls; configurable combatants, scripted `requestPlayerChoice` results (including `null`), and a `rollValue` used by `rollInitiativeValue`.
- [ ] **Step 2: failing tests**
  - mob: `setInitiative` called with the rolled value; no effect, no choice.
  - boss start/end: `setInitiative` with `10000`/`-10000` (rank 0); no roll.
  - player rush: `applyEffect(actorId,"rush")` then `setInitiative(base+3)`.
  - player hunker: `setInitiative(base-6)`.
  - player offline (`requestPlayerChoice -> null`): `announceDefaultMarch` called, `setInitiative(base+0)`, no effect beyond march.
  - reset: `removeTempEffects` + `clearInitiative` called for every combatant before any roll.
  - defeated: a defeated combatant gets reset but no `setInitiative`.
  - `markChoosing(true)` then `markChoosing(false)` around each player.
- [ ] **Step 3:** run - FAIL.
- [ ] **Step 4:** implement the flow from the spec (reset pass; concurrent player choices with `null`->march + announce; apply pass switch on tag).
- [ ] **Step 5:** run - PASS; then add `rollForCombatant` single-combatant test + impl; run - PASS.

### Task 7: Foundry adapter + wiring (manual-checklist coverage)

**Files:** Create `src/adapter/foundry-adapter.ts`, `src/adapter/player-query.ts`, `src/adapter/boss-slots.ts`, `src/adapter/tagging-ui.ts`, `src/adapter/hooks.ts`, `src/settings.ts`, `src/main.ts`, `src/foundry-env.d.ts` (ambient globals).

**Interfaces:**
- Consumes: `TacticalInitiative`, pure logic, constants.
- Produces: `initModule()` wiring called from `main.ts`.

- [ ] **Step 1:** ambient declarations for the Foundry globals used (`game`, `Hooks`, `CONFIG`, `foundry.applications.api.DialogV2`, `ChatMessage`, `ui`, document classes) - typed narrowly, no blanket `any` in logic.
- [ ] **Step 2:** implement `FoundryAdapter implements FoundryPort` (flags, effects via `createEmbeddedDocuments`, `rollInitiativeValue` via dnd5e initiative roll, `requestPlayerChoice` via `User#query` with timeout -> `null`).
- [ ] **Step 3:** implement boss-slot lifecycle (createCombatant guard, paired end slot, retag/remove/defeat sync).
- [ ] **Step 4:** implement tagging UI (tracker context menu + best-effort sheet header) and settings.
- [ ] **Step 5:** register hooks in `main.ts`: `init` (settings + `CONFIG.queries`), `combatStart`/`combatRound` -> `rollForCombat`, `createCombatant` -> boss setup + mid-round `rollForCombatant`, `deleteCombat`/`deleteCombatant` -> cleanup; all guarded by active-GM.
- [ ] **Step 6:** `npm run typecheck` - PASS.

### Task 8: Assets + build

**Files:** Create `lang/en.json`, `styles/tactical-initiative.css`, `README.md`; build `scripts/main.js`.

- [ ] **Step 1:** `lang/en.json` with all `TACTICAL_INITIATIVE.*` keys used.
- [ ] **Step 2:** CSS for the "choosing" tracker indicator and tag badges.
- [ ] **Step 3:** README - install path under `Data/modules/tactical-initiative/`, feature summary, assumptions log, numbered manual test checklist.
- [ ] **Step 4:** `npm run build` - emits `scripts/main.js`.

### Task 9: Verify

- [ ] `npm run typecheck` - clean.
- [ ] `npm run test` - all green, pristine output.
- [ ] `npm run build` - `scripts/main.js` present.
- [ ] Advisor review before declaring done.

## Self-review

- **Spec coverage:** tagging (Task 7), defaults (Task 1), reroll at start/round (Tasks 6-7), player dialog + timeout->March (Tasks 6-7), effects apply/remove (Tasks 3,6,7), boss double-turn + multi-boss order (Tasks 4,6,7), mob normal (Task 6), cleanup (Tasks 6-7), deliverables (Task 8). Covered.
- **Placeholder scan:** none.
- **Type consistency:** `Tag`/`Choice`/`BossSlot`/`EffectChange`/`CombatantView`/`FoundryPort` names match constants.ts and the spec throughout.
