# Tactical Initiative

A FoundryVTT v13 module for the D&D 5e (`dnd5e`) system that replaces default
initiative with tag-based behavior. Every actor is tagged **Player**, **Boss**, or
**Mob**, and initiative is rerolled for all combatants at combat start and at the
start of every new round.

- **Player** - the owning player is prompted each round to **Rush** (+3 initiative,
  -1 to attacks/saves/checks), **March** (normal), or **Hunker Down** (-6 initiative,
  +2 to attacks/saves/checks). The -1/+2 applies via a real Active Effect.
- **Boss** - never rolls; acts once before all other combatants and once after them
  (two combatant entries per boss).
- **Mob** - rolls initiative normally.

## Requirements

- FoundryVTT **v13 or v14** (verified against v14).
- D&D 5e system (`dnd5e`): **4.0.0+** on v13, **5.3.0+** on v14 (earlier dnd5e
  releases do not run on Foundry v14).

On v14 the module emits Active Effects in the v14 schema (`system.changes` with a
string `type`); on v13 it emits the legacy shape (root `changes` with a numeric
`mode`). This is selected automatically from `game.release.generation`.

## Install

Repository: <https://github.com/zyeri/foundry-tactical-initiative>

The module folder Foundry loads must contain the built files: `module.json`,
`scripts/main.js`, `styles/tactical-initiative.css`, `lang/en.json`. `scripts/main.js`
is checked into the repo, so a plain clone is already installable - you only need to
build if you change the TypeScript in `src/`.

Your Foundry **user data** folder (`<FoundryUserData>`) contains `Data/modules/`. Find
it from Foundry's **Configuration** screen ("User Data Path"). On Windows it is usually:

```
C:\Users\<you>\AppData\Local\FoundryVTT
```

### Option A - Manifest URL (Foundry's installer)

1. In Foundry: **Add-on Modules -> Install Module**.
2. Paste this into **Manifest URL** and click **Install**:

   ```
   https://raw.githubusercontent.com/zyeri/foundry-tactical-initiative/main/module.json
   ```

   This works once a GitHub **Release** with a packaged `tactical-initiative.zip` asset
   exists (the manifest's `download` points at the latest release). Until then, use
   Option B or C.

### Option B - Clone directly into modules (recommended for now)

Clone the repo straight into your modules folder, renaming it to the module id
`tactical-initiative`.

Windows (PowerShell):

```powershell
cd "$env:LOCALAPPDATA\FoundryVTT\Data\modules"
git clone https://github.com/zyeri/foundry-tactical-initiative.git tactical-initiative
```

macOS/Linux:

```bash
cd ~/.local/share/FoundryVTT/Data/modules   # adjust to your user data path
git clone https://github.com/zyeri/foundry-tactical-initiative.git tactical-initiative
```

Then restart Foundry (or reload the world) and enable **Tactical Initiative** in
**Game Settings -> Manage Modules**.

### Option C - Build from source, then copy

```bash
git clone https://github.com/zyeri/foundry-tactical-initiative.git
cd foundry-tactical-initiative
npm install
npm run check    # typecheck + tests + build (emits scripts/main.js)
```

Then copy the folder into `Data/modules/` as `tactical-initiative`. Windows PowerShell,
run from the cloned repo root:

```powershell
Copy-Item -Recurse -Force -Exclude node_modules,.git . "$env:LOCALAPPDATA\FoundryVTT\Data\modules\tactical-initiative"
```

`npm run build` compiles `src/*.ts` into `scripts/main.js` (the file Foundry loads).
Foundry does not run TypeScript, so always ship the built `scripts/main.js` - re-run
`npm run build` after any change under `src/`.

### Verify the install

After enabling the module, open the browser console (F12) and confirm you see:

```
tactical-initiative | initialized
```

## Usage

1. **Tag your actors.** Two ways: right-click a combatant in the combat tracker, or
   right-click an actor in the **Actors sidebar**, and pick **Tactical: tag as Player /
   Boss / Mob**. The Actors-sidebar menu is the reliable path when an alternative sheet
   or tracker module is installed. A best-effort tag dropdown also appears in the core
   actor-sheet window header. Defaults if never tagged: `character` actors are Players,
   everything else is a Mob. Retagging takes effect at the next roll.
2. **Start combat.** Initiative is rolled for everyone by tag. Players get a dialog on
   their own screen; if a player is offline or does not answer within the timeout
   (**Game Settings -> Configure Settings -> Tactical Initiative**, default 30s), they
   default to March and a chat note is posted.
3. **Each new round** re-runs the whole process: prior Rush/Hunker effects are removed
   and everyone rerolls.

Turn the **Skip Defeated** combat setting on so a defeated boss's two entries are both
skipped.

## Assumptions log

The exact v13/dnd5e API surface can shift between point releases. Where a signature was
uncertain, the most likely current API was chosen and isolated so it is easy to update:

1. **Player query.** Uses the v13 socketless query mechanism:
   `CONFIG.queries["tactical-initiative.chooseInitiative"]` plus
   `user.query(name, data, { timeout })`. The signature is confirmed against the
   Foundry v13 API docs. What an elapsed timeout or an offline user does
   (reject vs. resolve `undefined`) is not documented, so the module guards on
   `user.active`, wraps the call in try/catch, and treats any non-choice result as
   "no answer" -> March. See `src/adapter/player-query.ts`.
2. **dnd5e initiative roll.** Uses `combatant.getInitiativeRoll()` (dnd5e Combatant5e)
   when available, falling back to `actor.getInitiativeRoll()` and finally to
   `new Roll("1d20 + @attributes.init.total")`. This respects init bonuses and the
   Alert feat rather than hand-building a formula. See `src/adapter/foundry-adapter.ts`.
3. **Boss double-turn** is implemented as two combatant entries sharing the boss's
   token, sorted to `+10000-rank` (start) and `-10000-rank` (end). If a future Foundry
   dedupes combatants by token, this is the piece to revisit.
4. **Active Effect.** The -1/+2 is applied as ADD-mode changes to the dnd5e bonus
   paths `system.bonuses.{mwak,rwak,msak,rsak}.attack` and
   `system.bonuses.abilities.{check,save}`. If dnd5e renames these, update
   `DND5E_BONUS_KEYS` in `src/constants.ts`. The change **shape** is version-gated:
   v13 uses root `changes` with numeric `mode` (2 = ADD); v14 uses `system.changes`
   with string `type` (`"add"`), selected via `game.release.generation` in
   `applyEffect` (`src/adapter/foundry-adapter.ts`) using `toV14Changes`.
5. **Tag UI.** Three surfaces, most robust first:
   - **Combat-tracker menu** (right-click a combatant). Instead of the
     `getCombatantContextOptions` hook - which replacement trackers like *Carousel
     Combat Tracker* (`combat-tracker-dock`) never fire - the module wraps
     `CombatTracker#_getEntryContextOptions`, the method both the core sidebar and
     those trackers call. Falls back to the hook if the method is unavailable.
   - **Actors-directory menu** (right-click an actor in the sidebar), via
     `getActorContextOptions`. Sheet-independent, so it works regardless of the
     actor-sheet module (core dnd5e, *Tidy 5e*, ...). This is the reliable way to
     tag an actor outside combat.
   - **Actor-sheet header dropdown** (`renderActorSheet` / `renderActorSheetV2`) is
     best-effort for the core sheet and fails silently when another sheet module
     (e.g. Tidy 5e) replaces the header DOM. Use the directory menu instead there.
6. **Double-fire guard.** `combatStart` and `combatRound` can both fire for round 1 in
   some versions; a per-combat, per-round guard makes the reroll idempotent so players
   are prompted exactly once. After each reroll the combat turn pointer is reset to the
   top of the re-sorted order (`combat.update({ turn: 0 })`).
7. **Effects target world actors.** Temporary effects are applied via
   `game.actors.get(actorId)`, which is the linked-actor case (normal for player PCs,
   the only tag that gets effects). A player-tagged *unlinked* token would receive the
   effect on its base world actor rather than the token's synthetic actor. Not handled;
   noted here as a known limitation.

## Manual test checklist

Automated tests cover the pure logic and the roll-cycle orchestration, but NOT the live
Foundry integration. Run this checklist in a v13 + dnd5e world **and** a v14 + dnd5e
5.3+ world after any Foundry/dnd5e upgrade. Items 4, 6, and 11 are the ones no unit test
can catch. On v14 specifically, verify item 1 (the tag context menu actually appears)
and item 4 (the effect's `system.changes` apply with no deprecation warning in the
console) — both exercise the v14-specific code paths.

1. **Tag each type.** Right-click three combatants in the tracker; tag one Player, one
   Boss, one Mob. Confirm the tag sticks (reopen the menu). Also confirm the same menu
   appears when right-clicking an actor in the **Actors sidebar**, and (with a
   replacement tracker such as Carousel Combat Tracker active) that the tracker menu
   still appears on its combatant entries.
2. **Combat start rolls (SMOKE - exactly once).** Start combat with one Player.
   Confirm the choice dialog appears **exactly once** (not twice). Then confirm the Mob
   rolled a normal value, the Player rolled with their adjustment, and the Boss did not
   roll.
3. **Round-2 reroll with a changed choice.** Advance to a new round. Confirm everyone's
   initiative clears and rerolls, and a Player who picked Rush last round can pick
   Hunker Down this round and gets the new value.
4. **Rush/Hunker effect application (SMOKE).** Have a Player pick Rush. Confirm a
   "Rushing" effect icon appears on the token AND an attack/save/check d20 shows -1.
   Repeat with Hunker Down and confirm +2.
5. **Effect removal.** Advance a round (or end combat). Confirm the previous round's
   Rush/Hunker effect is gone and no longer modifies rolls.
6. **Boss double turn with 2+ bosses (SMOKE).** Tag two actors Boss. Start combat.
   Confirm each boss has two tracker entries, all four sort as
   BossA-start, BossB-start, ...normal rolls..., BossA-end, BossB-end, and each boss
   token actually gets two turns as the tracker advances.
7. **Mid-combat join.** With combat running, drop a new token in and add it to combat.
   Confirm a Mob rolls immediately, a Player is prompted immediately, and a Boss gets
   its two entries.
8. **Player-offline timeout.** Have a Player disconnect (or never answer). Confirm that
   after the timeout they default to March, a chat note is posted, and combat proceeds.
9. **Choosing indicator.** While a Player's dialog is open, confirm the GM's tracker row
   for that combatant is highlighted, and the highlight clears once they answer.
10. **Combat-end cleanup.** End/delete the combat. Confirm all module effects are
    removed from every actor and no duplicate boss entries linger.
11. **Round-2 turn pointer (SMOKE).** After the round-2 reroll, confirm play resumes on
    the correct combatant (the highlighted current turn is not off by one).

## Automation rules checklist (F4/F5, v1.2.0)

Run in a live v14 + dnd5e 5.3 world. Probes 1-2 gate the adapter behavior.

1. **Probe - damageActor deltas.** Log `changes` and `actor.system.attributes.hp.value`
   on a normal hit and on an overkill against a 0-HP actor. Confirm `changes.hp` is
   clamped so a corpse-overkill does not re-fire. If it is unclamped, switch death
   detection to a `preUpdateActor` last-seen-HP compare.
2. **Probe - chat-card flags.** Log `message.flags.dnd5e` and `message.speaker` on a
   player's damage roll. Confirm `roll.type === "damage"`, `item.uuid`,
   `targets[].uuid`, and `speaker.alias`/`speaker.actor` match `parseDamageCard`.
3. **Mob remove + hide.** Tag an UNLINKED token `mob`; drop it to 0 in combat. Only that
   token hides and leaves the tracker; sibling unlinked copies and untagged NPCs are
   untouched; the whispered "Restore" button re-adds it. A `mob` dropped OUT of combat is
   left alone. (Known limit: a LINKED mob auto-removes only when the GM views its scene.)
4. **Non-active combat.** With two combats, kill a tagged `mob` in the non-active one. It
   is still removed (across-combats lookup).
5. **Boss attribution.** Tag an UNLINKED token `boss`; a player kills it with a targeted
   weapon -> public "X has killed BOSS with their WEAPON!".
6. **No self-credit.** A boss whose own attack was the last damage card is never credited
   for its own death.
7. **Plain fallback.** Kill a boss with an untargeted AoE or a manual HP edit -> public
   "BOSS has fallen!".
8. **Toggle + dedupe.** `announceBossDeath` off suppresses the message. With two GMs
   connected, a boss death posts exactly once.

## Combatant groups checklist (B1a, v1.3.0)

v14 + dnd5e 5.3 only. **Probes first** (they gate the UI wiring):

1. **Native group rendering.** Does the v14 combat tracker render `CombatantGroup` rows
   natively? If so, style them; if not, the module's colored tag on each member row
   (`decorateTrackerGroups` in `src/adapter/group-ui.ts`) is the fallback the checks below
   assume.
2. **dnd5e group initiative.** Confirm dnd5e 5.3 `rollInitiative` does not fight the module
   setting each member's initiative explicitly, and that the native group `initiative`
   reflects the shared value. If not, read a member's initiative in `groupInitiativeValue`
   (`src/adapter/foundry-adapter.ts`).
3. **Ctrl-select signal.** Determine how the tracker exposes a multi-selected set of rows to
   a context action. `selectedCombatantIds` (`src/adapter/group-ui.ts`) reads a generous set
   of candidate selectors and falls back to the single right-clicked row; confirm the real
   selected-row class and narrow it.
4. **Rename/recolor dialog.** Rename/recolor use `foundry.applications.api.DialogV2.prompt`
   with an `ok` callback reading `button.form`. Confirm the callback receives the button and
   its form value in v14; adjust `DialogV2PromptButton` in `src/foundry-env.d.ts` if the
   signature differs.

Behavior checks:

5. **Ctrl-select -> add to group.** Ctrl-select two or more tracker rows, right-click, pick
   **Tactical: add to group**. Confirm a new group forms with those members.
6. **Shared initiative.** Start (or reroll) combat. Confirm every member of a group takes the
   same single initiative each round, with no per-tag prompt for grouped players.
7. **Grouped boss single turn.** Group a Boss with mobs. Confirm the boss takes ONE turn at
   the group's initiative. Grouping an already-slotted boss now tears down its start/end
   double-turn entries immediately (cascade-safe); its initiative settles to the group's
   shared value on the next reroll.
8. **Colored renameable tag.** Confirm each grouped row shows the colored group tag; **rename**
   and **recolor** from the row's context menu update it on the next render.
9. **Disband restores.** **Disband group** (or remove the last member). Confirm the members
   return to individual tag behavior on the next reroll.

## Group control HUD checklist (B1b, v1.4.0)

v14 + dnd5e 5.3 only. The HUD is the Foundry boundary (untested); its render protocol and
dnd5e calls are assumptions to confirm in a live world.

1. **Open from a group row.** Right-click a grouped combatant -> **Tactical: open group HUD**.
   Confirm a movable/resizable pop-out lists the group's members with name + HP.
2. **Select all.** Every member token is controlled on the canvas (move them together). A
   member without a scene token is skipped.
3. **Target all.** Every member token becomes one of your targets (existing targets kept).
4. **Apply damage / healing.** Enter an amount; confirm each member takes it through dnd5e
   `applyDamage` (resistances/immunities respected). Tick "heal" -> HP is restored instead. A
   member without a token still takes damage/healing via its actor.
5. **Toggle condition.** Enter a status id (e.g. `prone`); confirm it is added to every member;
   running it again removes it.

If an action does nothing, re-check the assumptions in a v14 / dnd5e 5.3 build: ApplicationV2
`_renderHTML`/`_replaceHTML` signatures, `DialogV2.prompt` form retrieval,
`actor.applyDamage(amount, { multiplier })`, `actor.toggleStatusEffect(statusId, { active })`,
and `canvas.tokens.get(id)` `control`/`setTarget`.

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

## Development

- `src/logic/*` - pure, unit-tested functions.
- `src/service.ts`, `src/death-service.ts` - orchestration, tested against in-memory fake
  ports (`test/fake-port.ts`, `test/fake-death-port.ts`).
- `src/adapter/*`, `src/main.ts` - the Foundry glue (manual-checklist coverage).
- See `docs/superpowers/specs/` and `docs/superpowers/plans/` for the design and plan,
  and `FUTURE_WORK.md` for the planned full mock harness.
