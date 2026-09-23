# Tactical Initiative - Map Grouping, Resizable Top Bar, Leftover-Combatant Sweep Design Spec

**Date:** 2026-09-22 (rev 2, after 8-reviewer pass)
**Status:** Draft for review
**Supersedes:**
- `2026-08-31-combatant-groups-design.md` grouping *input* flow (tracker ctrl-select +
  "Add to group") and its sidebar group decoration. B1's data model (native
  `CombatantGroup`, shared initiative, group-overrides-tags, control HUD) is kept.
- B2 top-bar spec (2026-09-01) group-cell click: click now expands the member list; the
  control HUD moves to the group cell's right-click menu.
**Release:** v1.5.0-rc2, all three parts together (DM decision). Implementation is split
into two plans (see Plan split).

Target: Foundry **v14** + **dnd5e 5.3+** only.

## Source feedback (DM, 2026-09-22)

1. Grouping does nothing after user input. DM wants to group from the battlemap: select
   tokens, add them all at once; spot inclusions/removals by right-clicking a token and
   using its "Group" setting. A group acts like a virtual token standing in for its
   members on the initiative tracker.
2. The top tracker bar is too small; it must be resizable by the user.
3. Deleting a token left its combatant in the tracker; the GM should be prompted to
   remove it.

## Root causes (code read + API research, 2026-09-22)

1. **Dead top-bar menu (certain).** `src/adapter/top-bar.ts:144` registers
   `window.addEventListener("pointerdown", closeMenu, { once: true })`. Pressing a menu
   item fires it first and removes the menu, so the item's `click` never fires. Every
   top-bar menu item (tags and groups) is dead.
2. **Group membership reads return null (very likely).** Every read uses
   `typeof combatant.group === "string"` (9 sites in 7 files). The v14 schema stores a
   `DocumentIdField`, but at runtime `Combatant#group` resolves to the `CombatantGroup`
   document: dnd5e 5.3 `module/documents/combatant.mjs` reads `this.group.id`. So the
   module never sees any group: no group cells, grouped-only menu entries hidden, HUD
   and shared initiative empty. Confirm with the live probe (Testing, P0).
3. **"Add to group" always creates a new one-member group.** No "existing group" path;
   dnd5e hides one-member groups in the sidebar, so it looks like nothing happened.
4. **Group initiative is never written.** `groupInitiativeValue` reads
   `group.initiative` (`src/adapter/foundry-adapter.ts:162-165`) but no module code writes
   it; `addToGroup` (`src/adapter/groups.ts:20-48`) sets only `group`.
5. **Token delete leftover (cause unknown).** Core already deletes a token's combatants
   (`Combat._onDeleteTokens`, v14 API; foundryvtt#3319, #11630) and since v13 asks for
   confirmation on Delete-key deletes of in-combat tokens (#11296). The DM saw a leftover
   after a plain GM delete on the viewed scene, which core should handle. Candidates:
   stale top bar (it does not redraw on `deleteToken`), a combat whose `scene` is null,
   a second combatant sharing the `tokenId`. Reproduce during the live probe.
6. **Fixed bar size.** Portraits hard-coded 44x44px (`styles/tactical-initiative.css:100`).

## DM decisions locked (2026-09-22)

- Group Selected trigger: **Token HUD button and keybinding**.
- Tokens not in combat: **added to combat**; combat created if none.
- Group tracker entry: **stacked portraits** (top bar).
- Group action: **create immediately if the combat has no groups; otherwise prompt new
  group or an existing one.**
- **One turn per group**: the group acts once; Next Turn skips past all its members.
- Resize: **drag handle**, saved per user.
- Token delete: **safety-net sweep** that prompts only for combatants core left behind.
- Tracker at the table: **dnd5e sidebar + top bar**. dnd5e 5.3 already renders
  `CombatantGroup`s (2+ members) as collapsible sidebar rows, so the module adds no
  sidebar group decoration.
- Approach: keep native `CombatantGroup`; no placeholder combatant.

## Part 1 - Map grouping

### Pure helpers (`src/logic/group.ts`, tested)

```ts
type GroupRef = { id: string; name: string; color: string | null };
type SelRef = { combatantId: string | null; groupId: string | null }; // null combatantId = not in combat

groupIdOf(c: { _source?: { group?: string | null }; group?: string | { id: string } | null }): string | null
// _source.group first; else string group; else group.id; else null.

nextGroupName(existing: readonly string[], base: string): string
// base = majority actor name among the selection (e.g. "Goblin"), fallback i18n "Group".
// Returns base if unused, else "base 2", "base 3", ... lowest unused.

resolveGroupChoice(selected: readonly SelRef[], groups: readonly GroupRef[]):
  | { kind: "none" }                                   // empty selection
  | { kind: "create" }                                 // combat has no groups
  | { kind: "prompt"; options: GroupRef[]; offerRemove: boolean }
// offerRemove = some selected has groupId !== null.
```

### GroupingService (`src/grouping-service.ts`, tested via `test/fake-grouping-port.ts`)

Port, shaped like `group-control-service.ts`:

```ts
interface GroupingPort {
  resolveCombat(): Promise<string>;                        // find or create + activate
  listCombatants(combatId): CombatantRef[];                // {id, tokenId, groupId, initiative, bossSlot}
  listGroups(combatId): GroupRef[];
  isStarted(combatId): boolean;
  createGroup(combatId, name): Promise<string>;
  createCombatants(combatId, tokenIds, groupId: string | null): Promise<string[]>;
  assign(combatId, ids, groupId): Promise<void>;           // sets group + initiative in one update
  unassign(combatId, ids): Promise<void>;
  deleteGroup(combatId, groupId): Promise<void>;
  rollGroupInitiative(combatId, groupId): Promise<number | null>;
  reconcileBoss(combatId, ids): Promise<void>;             // re-create end slots after leaving
  prompt(choice): Promise<{ action: "new"; name: string } | { action: "join"; groupId } | { action: "remove" } | null>;
  warn(key): void;
}
```

`groupSelected(tokenIds)` flow (order matters):

1. Empty `tokenIds` -> `warn("NothingSelected")`, stop.
2. `resolveCombat()`: prefer `game.combat` if its scene is null or matches the viewed
   scene; else a combat whose scene matches; else
   `Combat.implementation.create({ scene, active: true })`. Activate the resolved combat
   if not active (the top bar renders only `game.combats.active`).
3. Build `SelRef[]` (drop boss `end` slots; they share the boss `tokenId`), call
   `resolveGroupChoice`. `create` -> target = new group named by `nextGroupName`.
   `prompt` -> `port.prompt(choice)`; `null` (dismissed) -> stop, no writes.
4. Target decided **before** any combatant is created. For a new group: `createGroup`
   first.
5. Tokens not in combat: `createCombatants(combatId, ids, targetGroupId)` with `group`
   in the create data (via `TokenDocument.implementation.createCombatants` then set, or
   direct `createEmbeddedDocuments` carrying `group`; the plan picks after checking the
   v14 signature). The existing `createCombatant` hook (`src/adapter/hooks.ts:105-117`)
   then sees them as grouped and skips boss end-slots and tag prompts.
6. Tokens already in combat: `assign(ids, targetGroupId)`. Previous boss end-slots are
   torn down (existing `tearDownBossSlots`).
7. Initiative: if the combat has started, the target group's initiative is the first
   existing member's initiative; if none (new group), `rollGroupInitiative` once. All
   joiners get that value in the same `assign` update. Unstarted combat: no roll.
8. Remove action: `unassign(ids)`; each removed combatant keeps its current initiative;
   `reconcileBoss(ids)` restores boss end-slots (existing `reconcileBossOnRetag`); tag
   behavior resumes on the next reroll.
9. Empty-group sweep: any group (previous or target) with no members -> `deleteGroup`.
   The same sweep runs from the `deleteCombatant` hook (F4 mob death, Part 3, manual
   deletes).

### Entry points (adapter)

- **Token HUD button.** `renderTokenHUD(app, html: HTMLElement)` hook, GM only. Append a
  button to `html.querySelector(".col.left")` if not already present (guard against
  double injection). Plain listener, no `data-action`. Token set = controlled tokens plus
  `app.object` (deduplicated).
- **Keybinding.** Registered in `init` (`src/main.ts`):
  `game.keybindings.register(MODULE_ID, "groupSelected", { editable: [{ key: "KeyG" }],
  restricted: true, onDown: () => { ...; return true; } })`. Core binds no G; conflicts
  surface in Configure Controls.
- **Who writes.** Any GM who triggers the action writes directly (GM writes are
  authoritative). The active-GM gate stays only on hook-driven automation.
- **Dialog.** `DialogV2.wait({ rejectClose: false, buttons })` with a name text input
  (default from `nextGroupName`) above the buttons: **New group**, one button per
  existing group (name + color swatch), **Remove from group** when `offerRemove`.
  The silent `create` path uses the default name; rename stays on the menu.
- All callbacks go through one `runSafe(label, fn)` helper that awaits and logs
  rejections with `MODULE_ID` plus a UI error notification.

### One turn per group

- **Contiguity.** Grouped members share one initiative, but ties with other combatants
  could interleave them. Sort tie-break for equal initiative: group id, then core order.
  Implemented by wrapping `Combat.prototype._sortCombatants` (the plan verifies the v14
  name/signature; fallback: offset group initiative by a group-stable epsilon).
- **Skip.** A `preUpdateCombat` hook (any client that issues the turn change) rewrites
  `changes.turn`: moving forward from a grouped combatant skips every following member of
  the same group; moving backward lands on the group's first member. Wrapping
  round-end behaves as core does. Works for any tracker that calls
  `nextTurn`/`previousTurn`/`update({turn})`.
- Consequence (accepted): per-turn automation keyed on a combatant's own turn start
  fires only for the group's first member.

### Top-bar group cell

- One cell per group: up to 3 overlapping portraits, group name, `xN` badge, group color
  border. Built from the visibility-filtered member list
  (`src/logic/tracker-view.ts:121-123`) so hidden members never reach players.
- Count and portraits cover **living** members; defeated members are excluded from the
  stack and counted as `xLiving/Total` when any are defeated.
- One-member groups render as a group cell (unlike dnd5e's sidebar), so the GM sees the
  result of every group action.
- **Click**: toggles an expanded member list, rendered as a `position: fixed` popover on
  `document.body` (not clipped by the bar's scroll). Expanded group ids live in module
  state and survive redraws. Clicking a member controls and pans to its token (GM or
  owner, as `focusToken` does).
- **Right-click**: a group-target menu resolving `data-groupId` (new builder; existing
  `pushGroupOptions` resolves `data-combatantId`): Rename, Recolor, Open HUD, Disband.
- View model: `TrackerRow` for groups gains `portraits: string[]` (max 3),
  `members: { id, name, img, defeated }[]`, `living: number`, `total: number`;
  `img` stays equal to `portraits[0]`.

### Removed

- "Add to group" from sidebar and top-bar combatant menus; `selectedCombatantIds`,
  `addSelectionToNewGroup` (`src/adapter/group-ui.ts:57-87, 198-204`); i18n `Group.AddTo`.
- Module sidebar group decoration (dnd5e renders groups).
- README B1a ctrl-select checklist items (README:252, 262-263, 315) marked superseded.

### Fixes carried

- Top-bar menu closes only on `pointerdown` outside it (`!menu.contains(target)`).
  Menu DOM wiring moves to `src/ui/menu.ts` (no Foundry globals) for happy-dom tests.
- Top bar redraws on `createCombat`, `createCombatantGroup`, `updateCombatantGroup`,
  `deleteCombatantGroup`, `updateActor`, `createToken`, `deleteToken`.
- `FoundryCombatant` typing (`src/foundry-env.d.ts:102`) gains
  `_source: { group?: string | null }` and `group: string | FoundryCombatantGroup | null`.
- dnd5e syncs member initiative updates back to the group. The module batches member
  writes into one `updateEmbeddedDocuments` call per action and does not write
  `group.initiative` separately from member updates.

## Part 2 - Resizable top bar

- **Structure.** `#tactical-initiative-top-bar` becomes a persistent, non-scrolling
  wrapper holding (a) an inner `.tb-strip` that `render()` rebuilds and that scrolls
  horizontally, and (b) a persistent `.tb-grip` sibling that `render()` never replaces.
  `--ti-portrait` is set on the wrapper. Redraws during a drag do not interrupt it.
- **Grip.** Bottom-right of the wrapper; `cursor: ns-resize`; `touch-action: none`.
  Size = `clampBarSize(startSize + (clientY - startY))`: vertical drag only.
  `setPointerCapture` on pointerdown; end on `pointerup`, `pointercancel`,
  `lostpointercapture`; `stopPropagation` so rows do not react.
- **Persist.** `SETTINGS.TOP_BAR_SIZE`, `scope: "user"` (follows the user across
  devices), `type: Number`, `default: 44`, `config: false`. Written once on drag end,
  skipped if unchanged. Accessor `getTopBarSize()` goes through `clampBarSize`. Applied
  on every render, including while hidden.
- **Reset.** Double-click the grip -> 44, cancels any pending write.
- **Keyboard.** Grip is focusable, `role="separator"`, `aria-valuenow/min/max`; Up/Down
  change by 4px, Home resets.
- **`clampBarSize(px: number): number`** (`src/logic/bar-size.ts`): `Math.round`, clamp
  to 32..128; `NaN` -> 44; `+/-Infinity` clamp to the bound.
- **CSS scaled by `--ti-portrait` (P = portrait size, base 44):** portrait width/height
  (css:102-103), border and radius (css:105-106), current-turn `translateY(-3px)`
  (css:114; the 1.08 scale already scales), HP bar height (css:125), hp-text bottom and
  font (css:131, 134), count and condition badge offsets, padding, radius, font
  (css:141-158), round label font (css:170), stacked-portrait offset, group name label,
  turn buttons (`.tb-btn`, new rule). Ratios keep the 44px look exactly at default;
  fonts use `max(9px, calc(...))`.
- **Footprint.** At 128px the bar is ~150px tall inside `#ui-top`. Manual check in a
  live world for collision with notifications and scene navigation; if it collides,
  cap strip height and scroll.

## Part 3 - Leftover-combatant sweep

Core deletes combatants of a deleted token; the module only catches what core misses.

- **Hook.** `deleteToken(doc, options, userId)` fires on every client; the sweep runs
  on the active GM only (`isActiveGM()`), regardless of who deleted.
- **Batch.** Deleted `{sceneId, tokenId}` pairs go into a module-level queue; a
  module timer flushes it 1000 ms after the last deletion (plain `setTimeout`; 250 ms risked prompting before core's own combatant deletes reached the active GM). This batches multi-deletes and lets
  core's own combatant deletion finish first.
- **Flush.** Pure helper `findLeftovers(combats, deleted, tokenExists)` in
  `src/logic/leftovers.ts`: combatants in any combat whose `(sceneId, tokenId)` is in the
  queue and whose token no longer exists (`game.scenes.get(sceneId)?.tokens.has(tokenId)`
  is false). Output `{ combatId, combatantId, name }[]`, ordered by combat then turn
  order, deduplicated.
- **Prompt.** None found -> nothing. Found -> DialogV2 "These combatants lost their
  token: <names>. Remove them?" **Remove** / **Keep**. On Remove, re-fetch each id and
  skip ones already gone (another GM or core), then delete; then the empty-group sweep.
- **Keep.** Combatant stays with a "missing token" marker on the top bar.
  `TrackerCombatant.tokenMissing: boolean` from `game.scenes.get(sceneId)?.tokens.has()`
  (not `canvas.tokens`, which is only the viewed scene). The sidebar gets no marker.
- **Keep safety.** Combatants with no actor are skipped by `listCombatants` for rolls, so
  a kept unlinked combatant cannot break the next reroll
  (`src/adapter/foundry-adapter.ts:125-129`, `src/service.ts:43-45`).
- **Out of scope.** Scene deletion; undo of a token delete (core recreates with the same
  id, so a kept combatant reattaches).
- Separately: `restoreMob` warns when its token no longer exists
  (`src/death-service.ts:133-134`) instead of silently doing nothing.

## Wiring

- `src/constants.ts`: `SETTINGS.TOP_BAR_SIZE`, keybinding id.
- `src/settings.ts`: register `TOP_BAR_SIZE`; `getTopBarSize()`.
- `src/main.ts` `init`: keybinding registration; `renderTokenHUD`, `preUpdateCombat`,
  `deleteToken`, `deleteCombatant` (empty-group sweep) registrations via named
  `register*` functions like the existing ones.
- `module.json` and `package.json`: version `1.5.0-rc2` (newer than rc1's `1.5.0` for Foundry update detection); tag `v1.5.0-rc2`.
- `lang/en.json` new keys: HUD button title; keybinding name and hint;
  NothingSelected warning; group dialog title, name label, New group, Remove from
  group; leftover dialog title, body, Remove, Keep; missing-token marker; grip title;
  group menu Open HUD; restore-mob token-missing warning. Remove `Group.AddTo`.
- `README.md`: new checklist sections (below); B1a ctrl-select items superseded; B2
  group-cell click text updated (README:308-309, 314-315).
- `FUTURE_WORK.md`: note that sidebar group decoration is left to dnd5e.

## Testing

**P0 live probe, before Task 1** (v14 + dnd5e 5.3 world, console):
`typeof game.combat.combatants.contents[0].group` on a grouped combatant; its
`_source.group`; `Combat.prototype._sortCombatants` existence; reproduce the DM's
token-delete leftover (plain GM delete on viewed scene; note top bar vs sidebar). Record
results in the spec before implementation.

**Vitest, node env (pure):**
- `groupIdOf`: `_source` string, string field, document field, ungrouped.
- `nextGroupName`: unused base, collisions, gaps after disband.
- `resolveGroupChoice`: empty -> none; no groups -> create; groups -> prompt;
  `offerRemove` true only when a selection is grouped.
- `findLeftovers`: token gone vs present, boss end-slot remaining, same token in two
  combats, other scenes ignored, dedup and order.
- `clampBarSize`: below/above bounds, rounding, NaN, Infinity.
- `buildTrackerView`: portraits capped at 3, hidden members excluded for players,
  living/total with defeated members, `tokenMissing`.
- Turn skip: pure `nextTurnIndex(turns, current, direction)` over `{id, groupId}[]`:
  forward skip, backward to first member, round wrap, ungrouped unaffected.

**Vitest (GroupingService + fake port):** no combat -> created and activated; tokens
partly in combat; group created before combatants and passed in create data; started
combat copies member initiative / rolls for a new group; dismiss -> no writes; remove
restores boss; emptied group deleted.

**Vitest, happy-dom (`// @vitest-environment happy-dom`, only these files):**
- `src/ui/menu.ts`: pointerdown then click on an item fires the callback;
  pointerdown outside closes.
- `src/ui/grip.ts`: drag yields clamped size; redraw of the strip mid-drag does not end
  the drag; dblclick resets; Up/Down/Home keys.

**Manual (README checklist, live v14 + dnd5e 5.3):**
- Group via HUD and via G: no combat on scene, combat without groups, with groups,
  tokens partly in combat, a boss in the selection (no stray end slot).
- Non-active GM groups successfully.
- Spot add/remove via one token; boss regains end slot after removal; last member
  leaving deletes the group.
- One turn per group: Next/Previous across a group; dnd5e sidebar shows the group row.
- Top-bar group cell: stacked portraits, expand survives an HP change, pan to member,
  right-click Rename/Recolor/Open HUD/Disband; tag menu items fire.
- Resize: drag during combat updates, reload persistence, second device same user,
  double-click reset, keyboard, 128px footprint.
- Delete: normal token (core handles, no module prompt), boss token, multi-select delete,
  player-initiated delete; Remove and Keep; kept combatant survives next reroll.

## Plan split

- **Plan A - fixes + Part 1:** pure helpers and `groupIdOf` refactor; menu extraction
  and pointerdown fix; redraw hooks and `runSafe`; GroupingService + port; entry points
  and dialog; turn skip; top-bar group cell; removals.
- **Plan B - Parts 2 and 3:** grip + CSS scaling + setting; leftover sweep + marker;
  restoreMob warning.
- Both land on `feat/map-grouping`; one v1.5.0-rc2 release after both.

## Out of scope

- Custom per-group images.
- Module sidebar group rendering (dnd5e owns it).
- Group actor / concatenated trait sheet (still deferred).
- Dice pools (separate module).
