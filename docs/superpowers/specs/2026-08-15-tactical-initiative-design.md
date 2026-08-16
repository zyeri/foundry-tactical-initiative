# Tactical Initiative - Design Spec

**Date:** 2026-08-15
**Status:** Draft for review
**Source requirements:** `prompts/2026-08-15-tactical-initiative-module.md` (the refined prompt)

## Goal

A FoundryVTT v13 + D&D 5e (dnd5e) module that replaces default initiative with
tag-based behavior. Every actor carries a tag - Player, Boss, or Mob - and initiative
is rerolled for all combatants at combat start and at the start of every new round,
with each tag running its own behavior.

## Architecture: the port seam

The module is split into three layers so the decision logic is testable without a live
Foundry runtime:

1. **Pure logic** (`src/logic/`) - no Foundry globals, no side effects. Deterministic
   functions: tag resolution, initiative math, effect-change data, boss-slot ordering.
2. **Orchestration service** (`src/service.ts`) - the roll-cycle flow. Depends only on
   the `FoundryPort` interface, never on Foundry directly. Fully unit-tested against an
   in-memory fake port.
3. **Foundry adapter + wiring** (`src/adapter/`, `src/main.ts`) - the thin layer that
   implements `FoundryPort` against real Foundry/dnd5e APIs and registers hooks. Not
   unit-tested; covered by the manual test checklist. A full mock harness for this layer
   is deferred (see `FUTURE_WORK.md`).

**Tech stack:** TypeScript (strictest tsconfig), vitest (unit tests), esbuild (bundle
`src/main.ts` -> `scripts/main.js`, the file Foundry loads). Full JSDoc on every export.

## Global constraints

- FoundryVTT v13; do not use APIs deprecated in v13.
- D&D 5e system (`dnd5e`), compatibility floor 4.0.0.
- All initiative-altering logic runs GM-side (the active GM only). Player clients only
  answer the choice dialog.
- ASCII-only text, no emoji, in all authored files.
- No placeholders or stubs in shipped code.
- If an exact v13/dnd5e API signature is uncertain, pick the most likely current one and
  record it in the README assumptions log rather than silently using a deprecated API.

## Data model

- Actor flag `flags["tactical-initiative"].tag`: `"player" | "boss" | "mob"`.
- Default when unset: `character`-type actors -> `player`; all other types -> `mob`.
- Combatant flags: `bossSlot` (`"start" | "end"`), `primaryId` (on end slots),
  `bossOrder` (stable rank), `choosing` (true while a player's dialog is open).
- ActiveEffect flag `flags["tactical-initiative"].temp = true` marks module-created
  effects that are safe to auto-remove.

## Pure logic contracts (TDD first)

### `resolveTag(actorType: string, storedTag: string | null | undefined): Tag`
- Returns the stored tag when it is one of `"player" | "boss" | "mob"`.
- Otherwise returns `"player"` when `actorType === "character"`, else `"mob"`.

### `initiativeAdjustment(choice: Choice): number`
- `rush -> 3`, `march -> 0`, `hunker -> -6`.

### `normalizeChoice(raw: unknown): Choice`
- Returns `raw` when it is one of the three valid choices; otherwise `"march"`.
- Used to sanitize a dialog result before use.

### `effectChangesFor(choice: Choice): EffectChange[]`
- `march -> []` (no effect).
- `rush -> ` one change per `DND5E_BONUS_KEYS` with `value: "-1"`, `mode: ADD (2)`.
- `hunker -> ` same keys with `value: "+2"`, `mode: ADD (2)`.
- `EffectChange = { key: string; mode: number; value: string; priority: number }`.

### `bossSlotInitiative(slot: BossSlot, rank: number): number`
- `start -> 10000 - rank`; `end -> -10000 - rank`.
- Guarantees: every start slot sorts above any plausible d20 roll; every end slot below;
  and for two bosses with ranks `a < b`, boss `a` sorts before boss `b` at both ends
  (Foundry sorts initiative descending).

## FoundryPort interface

The service depends only on this. The real adapter and the test fake both implement it.

```ts
interface CombatantView {
  id: string;
  actorId: string;
  actorName: string;
  tag: Tag;
  isDefeated: boolean;
  bossSlot: BossSlot | null;   // set only on boss combatants
  bossRank: number | null;     // set only on boss combatants
}

interface FoundryPort {
  listCombatants(combatId: string): Promise<CombatantView[]>;
  clearInitiative(combatantId: string): Promise<void>;
  removeTempEffects(actorId: string): Promise<void>;
  applyEffect(actorId: string, choice: Choice): Promise<void>;
  rollInitiativeValue(combatantId: string): Promise<number>; // rolls, returns, no persist
  setInitiative(combatantId: string, value: number): Promise<void>;
  requestPlayerChoice(combatantId: string): Promise<Choice | null>; // null = offline/timeout
  markChoosing(combatantId: string, choosing: boolean): Promise<void>;
  announceDefaultMarch(actorName: string): Promise<void>;
}
```

## Service flow: `rollForCombat(combatId)`

1. List combatants.
2. Reset pass: for every combatant, `removeTempEffects(actorId)` then
   `clearInitiative(id)`.
3. Skip defeated combatants for the rest.
4. Player choices concurrently: for each player combatant, `markChoosing(true)`,
   `requestPlayerChoice`, `markChoosing(false)`. If the result is `null`, treat as
   `march` and `announceDefaultMarch(name)`.
5. Apply pass, per tag:
   - **boss:** `setInitiative(id, bossSlotInitiative(bossSlot, bossRank))`. No roll.
     Malformed boss (missing slot/rank) is skipped.
   - **mob:** `v = rollInitiativeValue(id)`; `setInitiative(id, v)`.
   - **player:** `applyEffect(actorId, choice)`; `base = rollInitiativeValue(id)`;
     `setInitiative(id, base + initiativeAdjustment(choice))`.

`rollForCombatant(combatId, combatantId)` applies steps 3-5 to a single combatant, used
for mid-round joins.

## Adapter and wiring (manual-checklist coverage)

- Hooks: `combatStart` and `combatRound` -> `rollForCombat`; `createCombatant` (when
  `combat.started`) -> boss-slot setup and/or `rollForCombatant`; `deleteCombat` and
  `deleteCombatant` -> cleanup.
- Active-GM guard: only `game.users.activeGM === game.user` runs roll logic.
- Player dialog: registered under `CONFIG.queries["tactical-initiative.chooseInitiative"]`
  at `init`; the GM calls `owningUser.query(name, data, { timeout })`. On the player
  client the handler shows a `DialogV2` with three buttons and returns the choice. A
  rejected/timed-out query yields `null`.
- Boss paired entries: when a boss-tagged actor joins combat, keep the natural combatant
  as the start slot (flagged) and create a second end-slot combatant (flagged with
  `primaryId`), guarded so the created entry does not recurse. Ranks assigned by join
  order keep multi-boss ordering consistent. Removing or retagging a boss removes its
  end slot; a defeated primary marks its end slot defeated too.
- Tag UI: a right-click context-menu option on combatants in the tracker (primary,
  reliable path), plus a sheet-header control (secondary; exact v13/dnd5e header hook is
  an assumption logged in the README).
- Effects: `applyEffect` builds the AE from `effectChangesFor(choice)`, sets
  `flags.tactical-initiative.temp`, an icon, and `origin`, so the -1/+2 auto-applies to
  attacks, saves, and checks and shows on the token.

## Cleanup

- Every roll cycle removes all module temp effects before rerolling.
- `deleteCombat` removes all module temp effects from all combatant actors and deletes
  duplicate boss combatants.
- Retagging away from boss deletes the end slot; retagging to boss creates it.

## Settings

- `playerTimeoutSeconds` (world, Number, default 30, range 5-300): how long to wait for a
  player's choice before defaulting to March.

## Testing strategy

- **Unit (vitest, TDD):** all pure logic functions and the full `rollForCombat` /
  `rollForCombatant` flow via an in-memory fake `FoundryPort` that records calls and can
  script player choices, offline (`null`), defeated combatants, and multiple bosses.
- **Manual checklist (README):** tagging each type, combat-start rolls, round-2 reroll
  with a changed player choice, Rush/Hunker effect apply+remove, boss double turn with
  2+ bosses, mid-combat join, player-offline timeout, and combat-end cleanup.
- **Deferred:** full in-memory Foundry mock harness for the adapter (`FUTURE_WORK.md`).

## Deliverables

1. Installable module tree: `module.json`, `scripts/main.js` (built), `styles/`,
   `lang/en.json`.
2. Source: `src/**/*.ts`, `test/**/*.ts`, build/test config.
3. README with install steps (path under `Data/modules/`) and the assumptions log.
4. Numbered manual test checklist (in the README).
5. `FUTURE_WORK.md` (full mock harness plan).

## Assumptions / known-weak spots

- The v13 player-query mechanism (`CONFIG.queries` + `User#query`) is the piece most
  likely to need adjustment across v13 point releases; the adapter isolates it and the
  README logs it.
- The exact sheet-header hook for dnd5e ApplicationV2 sheets is uncertain; the
  context-menu tag UI is the guaranteed path and the header control is best-effort.
- dnd5e applies AE `ADD`-mode changes to the `system.bonuses.*` string fields; if a
  future dnd5e version changes those paths, only `DND5E_BONUS_KEYS` needs updating.
