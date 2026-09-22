# Tactical Initiative - Map Grouping, Resizable Top Bar, Token-Delete Prompt Design Spec

**Date:** 2026-09-22
**Status:** Draft for review
**Supersedes:** the grouping *input* flow of `2026-08-31-combatant-groups-design.md`
(tracker ctrl-select + "Add to group"). The B1 data model (native `CombatantGroup`,
shared initiative, group-overrides-tags, control HUD) is kept.
**Release:** v1.6.0, all three parts together (DM decision).

## Source feedback (DM, 2026-09-22)

1. Grouping does nothing after user input. DM wants to group from the battlemap: select
   tokens, add them all at once; spot inclusions/removals by right-clicking a token and
   using its "Group" setting. A group acts like a virtual token standing in for its
   members on the initiative tracker.
2. The top tracker bar is too small; it must be resizable by the user.
3. Deleting a token left its combatant in the tracker; the GM should be prompted to
   remove it.

## Root causes found (code read, 2026-09-22)

- **Dead top-bar menu.** `src/adapter/top-bar.ts:144` registers
  `window.addEventListener("pointerdown", closeMenu, { once: true })`. Pressing a menu
  item fires that listener first and removes the menu, so the item's `click` never
  fires. Every top-bar menu item (tags and groups) is dead.
- **"Add to group" always creates a new group.** `pushGroupOptions` calls
  `addToGroup(..., null)`; there is no "existing group" path and the top bar has no
  multi-select, so each use makes a new one-member group that renders like an ungrouped
  combatant.
- **Possible id-type mismatch (unverified).** All membership reads use
  `typeof combatant.group === "string"`. If v14 returns the `CombatantGroup` document
  instead of its id, every group read yields null.
- **No token-delete handling.** The module has no `preDeleteToken`/`deleteToken` hook.
  Boss end-slots share the boss's `tokenId`, so a second combatant can be orphaned too.
- **Fixed bar size.** Portraits are hard-coded at 44x44px
  (`styles/tactical-initiative.css:100`); no size setting exists.

## DM decisions locked (2026-09-22)

- Trigger for "group selected tokens": **both** a Token HUD button and a keybinding.
- Tokens not in combat: **added to combat** (combat created if the scene has none).
- Group tracker entry: **stacked portraits**.
- Group action prompt: **create a group immediately if the combat has no groups;
  otherwise prompt for a new group or one of the existing groups.**
- Resize: **drag handle**, saved per user.
- Token delete: **Remove / Keep** dialog.
- Approach: keep native `CombatantGroup`; no placeholder combatant.

## Part 1 - Map grouping

### Group Selected action

Entry points (GM only; active GM for document writes):

- **Token HUD button.** `renderTokenHUD` hook adds a "Group" icon to the HUD's left
  column. Operates on all controlled tokens plus the HUD's token (if not controlled).
- **Keybinding.** `game.keybindings.register(MODULE_ID, "groupSelected", ...)`, default
  key `G`, GM-restricted. Operates on all controlled tokens. No-op with a warning
  notification if nothing is controlled.

Flow for a token set `T`:

1. Resolve the scene's combat: `game.combats.find(c => c.scene?.id === canvas.scene.id)`
   (prefer `game.combat` if it matches). If none, create one for the scene.
2. For each token in `T` without a combatant in that combat, create a combatant
   (`combat.createEmbeddedDocuments("Combatant", [{tokenId, sceneId, actorId, hidden}])`).
   Boss tags do not spawn end-slots for tokens that are about to be grouped.
3. Decide the target (pure function `resolveGroupChoice`, see Testing):
   - Combat has **no groups**: create a new group ("Group N", next free N) and add `T`.
     No dialog.
   - Combat **has groups**: DialogV2 with buttons: **New group**, one button per
     existing group (name + color swatch), and **Remove from group** (shown only if at
     least one combatant of `T` is grouped). Cancel/close does nothing.
4. Apply via the existing `groups.ts` functions (`addToGroup(combat, ids, groupId|null)`,
   `removeFromGroup`). Joining an existing group copies the group's `initiative` onto
   the joining members (existing `service.ts:67-70` behavior).
5. A group whose last member leaves is deleted.

Spot inclusion and removal use the same action on a single token: right-click the
token, click the HUD "Group" icon, choose a group or **Remove from group**.

Rename, recolor, and disband stay on the tracker group entry's right-click menu.

### Membership reads

Replace every `typeof combatant.group === "string"` read (`top-bar.ts`,
`foundry-adapter.ts`, `group-control.ts`, `groups.ts`, `group-ui.ts`, `hooks.ts`,
`boss-slots.ts`) with one helper `groupIdOf(combatant)` in `src/adapter/groups.ts`:
`combatant._source?.group ?? (typeof combatant.group === "string" ? combatant.group :
combatant.group?.id) ?? null`. Works whether v14 exposes the id or the document.

### Group entry on the trackers (the "virtual token")

- **Top bar.** A group renders as one cell: up to 3 overlapping member portraits
  (offset stack), group name, `xN` member-count badge, group color as the cell border.
  Clicking the cell toggles an expanded member list under it; clicking a member
  controls and pans to its token. Right-click opens the group menu (Rename, Recolor,
  Disband, Open HUD).
- **Sidebar tracker.** Members are collapsed under one group row using the same view
  model where the tracker DOM allows; if a third-party tracker replaces the sidebar,
  only the top bar is guaranteed.
- View model: extend the pure `buildTrackerView` so a group row carries
  `portraits: string[]` (max 3, member order) and `members: {id, name, img}[]`.

### Removed

- The "Add to group" item on the sidebar and top-bar combatant menus. Grouping starts
  from the map.

### Fixes carried in this part

- Top-bar menu closes only on a `pointerdown` outside the menu
  (`!menu.contains(event.target)`), so items fire.
- Top bar redraws on `createCombatantGroup`, `updateCombatantGroup`,
  `deleteCombatantGroup`, and `updateActor`.
- Menu and dialog callbacks attach `.catch` and log with `MODULE_ID` instead of dropping
  rejections.

## Part 2 - Resizable top bar

- A grip element on the bar's bottom-right corner. Pointer drag sets portrait size,
  clamped to **32-128px**, default **44px**.
- Size drives one CSS custom property `--ti-portrait` on the bar. Badge font, HP bar
  height, round label, and current-turn scale derive from it via `calc()`.
- Stored in a hidden client setting `topBarSize` (`scope: "client"`, `config: false`),
  written once on pointerup. Each user has their own size.
- Double-click the grip resets to 44px.
- Pure helper `clampBarSize(px)` handles rounding and bounds.

## Part 3 - Token-delete prompt

- Hook `preDeleteToken` (GM clients). Only the active GM prompts; other GMs pass
  through.
- Find all combatants in any combat with matching `sceneId` + `tokenId` (includes boss
  end-slots). Pure helper `combatantsForTokens(combats, sceneId, tokenIds)`.
- None found: return, deletion proceeds, no prompt.
- Found: let the deletion proceed and show a DialogV2 "Remove <name> from combat?"
  with **Remove** / **Keep**. Batched: tokens deleted in the same tick (multi-delete)
  collect into one dialog listing all names.
- **Remove** deletes those combatants; any group left empty is deleted.
- **Keep** leaves them; their tracker entries show a "missing token" marker (token id
  no longer resolves on the scene).

## Testing

Vitest (pure logic, `test/`):

- `resolveGroupChoice`: no groups -> create; groups exist -> prompt; "Remove" offered
  only when a selected combatant is grouped.
- `combatantsForTokens`: single token, boss with end-slot, same token in two combats,
  other scenes ignored.
- `clampBarSize`: below min, above max, non-integer, NaN -> default.
- `buildTrackerView`: group row portraits capped at 3, member list order, member count.
- `groupIdOf`: string id, document object, `_source` present, ungrouped.

Manual (README checklist additions, live v14 + dnd5e 5.3 world):

- Group selected via HUD and via `G`: no-combat scene, combat without groups, combat
  with groups, tokens partly in combat.
- Spot add/remove via single-token HUD; last member leaving deletes the group.
- Top-bar group cell: stacked portraits, expand, pan-to-member, rename/recolor/disband.
- Top-bar menu items (tags) now fire.
- Resize drag, persistence across reload, double-click reset, per-user independence.
- Delete one token, a boss token, several tokens at once; Remove and Keep paths.
- Pre-release check: record `typeof game.combat.combatants.contents[0].group` in v14.

## Out of scope

- Custom per-group images.
- Group actor / concatenated trait sheet (still deferred).
- Dice pools (separate module).
