# Tactical Initiative - Combatant Groups Design Spec

**Date:** 2026-08-31
**Status:** Draft for review
**Workstream:** B1 of 4. Siblings: A (automation rules, shipped in PR #1), B2 (top-bar
tracker), C (dice pools).
**Source requirements:** DM feature write-up (2026-08-30), feature 2.

## Scope

Let the GM group combatants so a group shares one initiative and is controlled from one
panel. Built on Foundry's native `CombatantGroup` document (v13+), integrated with the
workstream-A tag-based reroll cycle.

- **Grouping.** Ctrl-select combatants in the tracker, "Add to group" (new or existing);
  rename, recolor, remove a member, disband. Mixed tags allowed in one group.
- **Shared initiative.** The whole group rolls ONE initiative each reroll; every member
  takes it. Grouping OVERRIDES tag behavior: a grouped player gets no Rush/March/Hunker
  prompt, a grouped boss gets no start+end double-turn. Ungrouped combatants keep their
  tag behavior.
- **Colored, renameable tag** on the group in the combat tracker.
- **Control HUD** (action-only) opened from a group's tracker row, with four batch
  actions: select/move all tokens, target all, apply damage/healing to all, apply/remove
  a condition (or hidden/defeated) to all.

Target: Foundry **v14** + **dnd5e 5.3+** only (project decision).

## DM decisions locked (2026-08-30/31)

- Control scope: **Large - a group control HUD** (all four batch actions above).
- Group vs tags: **Group overrides tags** (one shared initiative; no prompt, no double-turn).
- Group makeup: **Mixed tags allowed.**
- Concatenated group trait-sheet: **deferred** (separate later feature or dnd5e's native
  Group actor).
- Build on the **native `CombatantGroup`**, not a custom document.

## Verified API facts (Foundry v13/v14 API, checked 2026-08-31)

1. **`CombatantGroup`** - native embedded document added in v13 for group initiative.
   Schema: `_id, _stats, flags, img, initiative (NumberField), name (StringField),
   ownership, system, type`. Runtime: `members: Set<Combatant>`, computed `defeated` and
   `hidden`, and `clearMovementHistories()`. **No native color field** -> store color as
   a module flag (`flags["tactical-initiative"].color`). Source: BaseCombatantGroup /
   CombatantGroup API.
2. **`Combatant.group`** - a `DocumentIdField`; a combatant joins a group by setting this
   to the group's id. `Combatant.initiative` remains an independent `NumberField`, so
   group membership does NOT auto-share initiative - the module assigns each member the
   group value during the reroll. Source: Combatant API.
3. **Create/assign** - `combat.createEmbeddedDocuments("CombatantGroup", [{ name, ... }])`
   returns the group; membership is `combatant.update({ group: groupId })` (or batch via
   `combat.updateEmbeddedDocuments("Combatant", ...)`).
4. **Open probes** (manual-checklist, verify live before the dependent code is trusted):
   whether the core v13/v14 combat tracker already renders group rows (style vs build);
   whether dnd5e 5.3 `rollInitiative` is group-aware in a way that conflicts with setting
   initiative explicitly; the exact ctrl-select signal the tracker exposes for
   multi-selecting combatant rows.

## Data model

- **Group:** native `CombatantGroup` (its `name` is the renameable label; its `initiative`
  is the shared value). No new document.
- **Group flag:** `flags["tactical-initiative"].color` on the group - the tag color.
- **Membership:** native `Combatant.group` (the group id). No module flag needed.
- No change to the existing actor tag flags; grouping is orthogonal to tags.

## Architecture

Three layers, matching the module's seam. All decision logic is pure or sits behind a
port and is TDD'd (strict-TDD mandate); only irreducible Foundry calls are the untested
boundary (manual checklist).

### Pure logic (`src/logic/`, unit-tested)

- **`group-initiative.ts` (new):** `assignInitiatives(entries, rolls)` where `entries`
  describe each combatant's id, its `groupId | null`, and its tag, and `rolls` supplies a
  rolled value per group and per ungrouped combatant. Returns a map of
  `combatantId -> initiative` in which every member of a group receives that group's single
  value, and ungrouped combatants receive their own. Pure; the reroll adapter supplies the
  rolled numbers. This is where "group overrides tags" for initiative is expressed:
  grouped combatants are assigned the group value regardless of tag.
- **`group-membership.ts` (new):** pure helpers - `groupsOf(entries)` (partition into
  groups + ungrouped), validation for add/remove/disband (e.g. a group needs >= 1 member;
  removing the last member disbands). No Foundry.

### Orchestration (`src/`, unit-tested against fakes)

- **Extend the reroll cycle.** `CombatantView` (`src/types.ts`) gains `groupId: string |
  null`. `TacticalInitiative.rollForCombat` partitions combatants: for each group it rolls
  once (via the port) and assigns all members that value through `assignInitiatives`;
  grouped combatants skip the per-tag path (no player query, no boss slots). Ungrouped
  combatants follow the existing tag flow unchanged. New `FoundryPort` methods:
  `listGroups(combatId)` and `rollGroupInitiative(groupId)`; tested via the existing
  fake-port pattern (`test/fake-port.ts`).
- **`GroupControlService` + `GroupControlPort` (new):** the HUD's four batch actions as
  orchestration behind a port, TDD'd against `test/fake-group-control-port.ts` (mirrors
  `DeathService`/`DeathPort`). Methods: `selectAndFrame(group)`, `targetAll(group)`,
  `applyToAll(group, amount, options)`, `setConditionAll(group, statusId, active)`. The
  port abstracts token selection, targeting, dnd5e `applyDamage`, and status effects.

### Adapter + UI (`src/adapter/`, manual checklist)

- **`groups.ts` (new):** the real `FoundryPort` group methods + `GroupControlPort` impl
  (create/assign/disband groups, read group color flag, select/target tokens, apply
  damage via each actor's `applyDamage`, toggle statuses).
- **Tracker UI (`src/adapter/tagging-ui.ts` or a new `group-ui.ts`):** a combat-tracker
  context-menu / control to "Add to group" from a ctrl-selected set; render the colored,
  renameable group tag on the group row; an "open group HUD" control. Reuses the existing
  robust tracker-hook approach (works with replacement trackers - see project memory on
  combat-tracker-dock).
- **`group-hud.ts` (new):** an ApplicationV2 panel showing the group's members and the
  four action buttons, delegating to `GroupControlService`. Self-contained; B2 embeds or
  links it later.
- **Wiring** in `main.ts` at init.

### B1/B2 boundary

The HUD is a standalone ApplicationV2 opened from the tracker row now. B2 (top-bar
tracker) later renders the same native group data and can embed/link the HUD - no rework
of the group model. Group data and color flag are the shared contract.

## Interaction with workstream A

- Grouping overrides the tag initiative path only; the tag flags themselves are untouched,
  so ungrouping a combatant restores its normal tag behavior on the next reroll.
- A grouped boss's start/end slot machinery (`boss-slots.ts`) must NOT run for grouped
  members: the reroll skips boss-slot setup when `combatant.group` is set, and
  `createCombatant`/retag paths check group membership before creating boss pairs.
- F4 (mob remove+hide) and F5 (boss callout) are unaffected: they key off death, not
  grouping. A grouped mob that dies still removes via `removeMobFromCombat`; group
  membership is cleared by Foundry when the combatant is deleted.

## Error handling

- All group mutation is elected-GM-only (reuse `isActiveGM`) and guard-wrapped.
- Disbanding a group clears each member's `group` field before deleting the group document.
- HUD actions no-op cleanly on an empty or stale group.

## Testing

- **Unit (vitest, TDD):** `assignInitiatives` (grouped share one value; ungrouped keep
  own; group overrides tag), `group-membership` validation (add/remove/disband, last-member
  disband); `GroupControlService` four actions against the fake port (each batch action
  hits every member; empty-group no-op; applyToAll respects per-member application);
  extended `TacticalInitiative` reroll with groups against `fake-port`.
- **Manual checklist (new README items):** the three probes above; ctrl-select ->
  add-to-group creates a native group; grouped enemies share one initiative each round;
  grouped boss takes a single turn (no double); colored renameable tag renders; each HUD
  action affects all members; disband restores individual behavior next round.

## i18n keys (add to `lang/en.json`)

- `TACTICAL_INITIATIVE.Group.AddTo` / `.New` / `.Rename` / `.Recolor` / `.Remove` / `.Disband`
- `TACTICAL_INITIATIVE.Group.DefaultName` (uses `{n}`)
- `TACTICAL_INITIATIVE.HUD.Title` / `.SelectAll` / `.TargetAll` / `.ApplyDamage` / `.Condition`

## Out of scope (deferred)

- The concatenated group trait-sheet (separate feature / dnd5e Group actor).
- The top-bar tracker rendering (B2) - B1 renders in the core tracker only.
- Cross-combat groups; a combatant in multiple groups (native `group` is single-valued).
- Group-level AI or automated movement paths ("act" beyond the batch actions).
