# Top-Bar Tracker (B2) Design

**Workstream:** B2 of 4. Siblings: A (automation rules, shipped in PR #1), B1 (combatant
groups, shipped in PR #1), C (dice pools, not yet specced).

**Goal:** A rich, always-on horizontal combat tracker rendered across the top of the screen,
showing every combatant (visibility-respecting) in initiative order as a portrait strip, with
GM turn controls. It is a **view** over Foundry's `Combat` document - turns, rounds, and
initiative stay Foundry-managed - and it **coexists** with the core sidebar tracker rather
than replacing it.

**Tech Stack:** TypeScript (strictest), vitest, esbuild, Foundry v14 + dnd5e 5.3.

**Depends on:** B1 (native groups + `partitionByGroup` + the group HUD) and A (the
`onActorDied` event from `combat-events.ts`). Execute after B1 lands.

## Design overview

The tracker is a custom DOM overlay (Approach A), not an ApplicationV2 window and not a
subclass of the core `CombatTracker`. A full-width container is injected into the Foundry UI
and re-rendered on combat changes. All decision logic lives in one pure, unit-tested
view-model function; the adapter only reads Foundry documents and writes DOM.

Rejected alternatives: an ApplicationV2 pinned bar (ApplicationV2 is window-oriented and a
frameless full-width bar fights its grain; it would also lean harder on the v14 ApplicationV2
API still unverified from B1b), and subclassing/replacing the core `CombatTracker` (wrong tool
given the coexist decision, and fragile across versions).

## The view-model seam (`src/logic/tracker-view.ts`, pure, TDD)

```
interface TrackerHp { value: number | null; max: number | null; shown: "full" | "bar" | "none" }

type TrackerRow =
  | {
      kind: "combatant";
      combatantId: string;
      name: string;
      img: string | null;
      initiative: number | null;
      tag: Tag | null;
      hp: TrackerHp;
      conditions: readonly string[];   // status ids for the icon overlays
      isCurrent: boolean;
      isDefeated: boolean;
      groupColor: string | null;
    }
  | {
      kind: "group";
      groupId: string;
      name: string;
      color: string;
      memberCount: number;
      initiative: number | null;
      img: string | null;      // representative member
      isCurrent: boolean;
    };

interface TrackerCombatant {
  id: string; name: string; img: string | null; initiative: number | null;
  tag: Tag | null; groupId: string | null; hidden: boolean; isDefeated: boolean;
  ownedByViewer: boolean; hp: { value: number | null; max: number | null };
  conditions: readonly string[];
}

interface TrackerInput { combatants: readonly TrackerCombatant[]; currentId: string | null }

interface Viewer { isGM: boolean; playerHpPolicy: "bar" | "none" }

function buildTrackerView(input: TrackerInput, viewer: Viewer): TrackerRow[];
```

`buildTrackerView` responsibilities (no Foundry globals, no side effects):

1. **Order:** consume `combatants` already in Foundry turn order (the adapter passes
   `combat.turns`).
2. **Visibility filter:** the GM keeps every combatant; a player drops any `hidden` combatant
   it does not own.
3. **HP policy:** GM or token owner -> `shown: "full"` (value + max); everyone else ->
   `viewer.playerHpPolicy` (`"bar"` renders the ratio bar only, `"none"` shows nothing).
4. **Group collapse:** reuse B1's `partitionByGroup`. A group's members collapse into one
   `kind: "group"` row placed at the group's first-seen turn position; ungrouped combatants
   stay `kind: "combatant"`. The group's `initiative` is the shared value; the representative
   `img` is the first member's.
5. **Current turn / defeated:** mark `isCurrent` from `currentId`; a group is current when any
   member is current. Carry `isDefeated` and `groupColor` through.

## Adapter + UI (`src/adapter/top-bar.ts`, untested boundary, manual checklist)

Defensive DOM, mirroring `group-ui.ts` (every render wrapped in try/catch; a failure never
breaks the screen).

- **`registerTopBar()`** at `init`: create a full-width container under `#ui-top`; first render
  at `ready`.
- **Re-render subscriptions:** `updateCombat`, `updateCombatant`, `createCombatant`,
  `deleteCombatant`, `deleteCombat`, and the module's existing `onActorDied`
  (`combat-events.ts`). The bar hides when there is no active combat.
- **Per-viewer:** each client renders its own bar for its own `game.user`; the adapter maps
  `combat.turns` -> `TrackerInput` (reading `ownedByViewer` from token/actor ownership and
  `hidden` from the combatant), then paints `buildTrackerView(input, viewer)`.
- **Row markup:** each row carries `data-combatant-id` or `data-group-id`. A combatant row is
  the token portrait with a thin HP bar underneath, a colored group border/badge when grouped,
  a tag badge, and status-icon overlays for conditions; the current turn is enlarged and
  highlighted. A group row is the representative portrait + the colored group tag + an
  `xN` member count + the one shared initiative.

### Interactions

- **Click** a combatant portrait -> pan the camera to and control the token (GM or owner).
- **Double-click** -> open the actor sheet.
- **Right-click** -> reuse `pushTagOptions` + `pushGroupOptions` (from `tagging-ui.ts` /
  `group-ui.ts`) to build the same context menu the sidebar shows - no new menu code.
- **Click a group row** -> `openGroupHud` (B1b).

### Turn control (GM only)

A small control cluster at the bar's end - previous turn, next turn, next round, end combat,
and the round number - calling the native `combat.previousTurn()` / `nextTurn()` /
`nextRound()` / `endCombat()`. Players see the bar but not the controls.

## Decisions

- **Defeated rendering** keys off native `combatant.isDefeated` plus HP. B2 does **not** touch
  workstream A's F5: the deferred "should boss death set the native `defeated` flag" question
  stays deferred, because the bar does not need it.
- **Settings (minimal):** `enableTopBar` (world/client, default on) and `playerHpPolicy`
  (`bar` | `none`, default `bar`). No position, opacity, or theme knobs in B2.

## Error handling

- All mutation is elected-GM-only (`isActiveGM`) and guard-wrapped.
- Every render is wrapped in try/catch; the bar no-ops on a stale or empty combat and hides
  when no combat is active.
- Turn controls are GM-gated in the DOM (not rendered for players) and re-checked on click.

## Testing

- **Unit (vitest, TDD):** `buildTrackerView` - turn ordering preserved; GM sees all vs a
  player drops unowned hidden combatants; HP policy (`full` for GM/owner, `bar`/`none`
  otherwise); group collapse places one row at the first-seen position and preserves order;
  current-turn mark (including a group current when a member is current); defeated carried
  through.
- **Manual checklist (new README section):** the bar appears on combat start and hides on end;
  order matches the sidebar; the current turn is highlighted and follows next/previous;
  players see only what they should and the GM sees all; click pans/controls, double-click
  opens the sheet, right-click shows the tag/group menu; a group row shows the shared
  initiative + count and opens the HUD; GM turn controls advance the native combat.

## i18n keys (add to `lang/en.json`)

- `TACTICAL_INITIATIVE.Tracker.NextTurn` / `.PrevTurn` / `.NextRound` / `.EndCombat`
- `TACTICAL_INITIATIVE.Tracker.Round` (uses `{n}`)
- `TACTICAL_INITIATIVE.Settings.EnableTopBar.Name` / `.Hint`
- `TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Name` / `.Hint`

## Interaction with A and B1

- Reads B1's native group data + color flag and reuses `partitionByGroup` and `openGroupHud`;
  no change to the group model.
- Subscribes to A's `onActorDied` for prompt death rendering rather than re-hooking dnd5e.
- Coexists with the sidebar tracker, which keeps its existing injections (tag menu, group tag,
  choosing indicator); B2 does not reproduce or remove them.

## Out of scope (deferred)

- Replacing or hiding the core sidebar tracker.
- Inline initiative editing, drag-to-reorder, player-facing turn controls, animations.
- The concatenated group trait-sheet (still deferred from B1).
- Position / opacity / theming controls.

## Forward-compatibility (C)

- The pure `buildTrackerView` seam is where any future per-row data (e.g. C's dice-pool state)
  is added and tested; the adapter stays a thin reader/painter.
