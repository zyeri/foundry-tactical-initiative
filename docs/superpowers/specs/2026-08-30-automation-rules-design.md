# Tactical Initiative - Automation Rules Design Spec

**Date:** 2026-08-30
**Status:** Draft for review (revised after two review rounds - 9 reviewer passes total)
**Workstream:** A of 4 (Automation rules). Sibling workstreams, each with its own
spec/plan cycle: B1 (combatant groups), B2 (top-bar tracker), C (dice pools).
**Source requirements:** DM feature write-up (2026-08-30), features 3, 4, 5.

## Scope

Three requested GM-side automation rules on the existing tag system. F3 collapses to the
module's current behavior and is dropped (see F3 rationale), leaving **F4** and **F5** to
build. No new UI beyond chat output and a GM-whispered undo link; no new persistent
documents. New hooks, a small internal event surface, two world settings, and pure logic
on the current port-seam architecture.

- **F4 - Explicitly-tagged mob at 0 HP is removed from combat and hidden.** When a creature
  whose stored tag is literally `mob` reaches 0 HP, delete the specific combatant that died
  and hide the specific token that died. Never an untagged NPC, never the rest of the pack.
  One-way, but the GM gets a one-click undo whisper.
- **F5 - Boss death posts a public chat callout with attribution.** When a `boss`-tagged
  actor reaches 0 HP and the `announceBossDeath` setting is on, post a public chat message
  naming the boss, and - when a recent real hit on that boss can be attributed - the killer
  and weapon: "Richard has killed BIG_MAN with their GUN." Otherwise a plain fallback line.

Target: Foundry **v14** + **dnd5e 5.3+** only (DM decision 2026-08-30). See "Manifest floor".

## DM decisions locked (2026-08-30, across both review rounds)

- **F4 behavior:** delete combatant + hide token (destructive), plus a GM-only undo whisper.
- **F4 trigger:** fires ONLY on an explicitly-stored `mob` tag, never the resolved default.
  Matches the write-up ("a creature tagged as mob").
- **F5 delivery:** public chat to everyone, gated by a world setting (default on).
- **F5 attribution:** tightened - record only real hits on this specific boss, apply a
  configurable staleness window (default 45s), no self-attribution.
- **F5 toggle:** ship `announceBossDeath` world setting, default on.
- **F5 window:** ship `killAttributionWindowSeconds` world setting, default 45.
- **F4 undo:** ship a GM-whispered "Restore <mob> to combat" link on each removal.
- **F3:** dropped as already-satisfied (see rationale).
- **Probes:** proceed to the implementation plan now; the live probes are the FIRST
  checklist steps, run before the code that depends on them is trusted.

## Verified API facts (dnd5e 5.3.x source @ 965ad2d, Foundry v14 API; two verification rounds)

1. **`actor.hasPlayerOwner`** - boolean getter on `ClientDocumentMixin`. (Was for F3;
   unused now that F3 is dropped. Kept here because B1/B2 will likely want it.)
2. **`dnd5e.damageActor(actor, changes, update, userId)`** - fires on an actor HP
   *decrease* (sibling `dnd5e.healActor` on increase). `changes = { hp, temp, total }` are
   signed DELTAS; the hook fires AFTER the update, so `actor.system.attributes.hp.value` is
   already the post-change value. `userId` is the applier, not the attacker; no damage
   source in the payload.
   - **Fires on EVERY connected client, not only the applier.** dnd5e emits it from the
     actor data model's `_onUpdate` (`attributes.mjs:532`, `npc.mjs:489`), which runs on
     all clients and does not gate the hook by `userId`. This corrects an earlier draft
     that assumed applier-locality. The elected active GM therefore always receives it,
     regardless of who applied the damage.
3. **`combatant.delete()`** and **`tokenDocument.update({ hidden: true })`** - correct v14
   ways to drop-from-combat and GM-hide. `hidden` is a `BooleanField` on the token schema.
4. **Token resolution.** `actor.getActiveTokens(linked = false, document = false)` returns
   Token PLACEABLES by default; pass `document = true` for `TokenDocument[]`. For a hidden
   update use `actor.getActiveTokens(false, true)` and call `.update()` on the returned
   documents. For an unlinked mob the hook's `actor` is the per-token synthetic actor
   (`actor.isToken === true`, `actor.token` is that `TokenDocument`), so `getActiveTokens`
   returns just that one token - the exact token that died.
5. **F5 attribution capture = the dnd5e chat card, via `createChatMessage` (CONFIRMED).**
   dnd5e's attack and damage rolls post chat messages (`attack.mjs:150`, `mixin.mjs:888`).
   `createChatMessage` is core document-CRUD: it broadcasts, so the GM client receives a
   player-authored card regardless of roll mode (visibility gates rendering, not the hook).
   The card carries `flags.dnd5e = { activity:{type,id,uuid}, item:{type,id,uuid},
   targets:[...], messageType:"roll", roll:{type:"attack"|"damage"} }` plus
   `speaker.actor` / `speaker.alias`. Exact reads:
   - Killer name: `message.speaker.alias` (best for unlinked) or resolve `speaker.actor`.
   - Weapon name: `fromUuidSync(flags.dnd5e.item.uuid)?.name` (or the message `flavor`).
   - Targets: `flags.dnd5e.targets[]`, each `{ uuid, name, ... }` - the target actor
     **UUID**, not id. Discriminate damage with `roll.type === "damage"`.
   - The dnd5e roll hooks (`rollAttack`/`rollDamage`/`postUseActivity`) fire only on the
     roller's client, so they are NOT usable GM-side; the card bridge replaces them and no
     socket relay is needed. `applyDamage`/`calculateDamage` carry no attacker, so they are
     not a substitute either. The card is the only clean GM-side "who hit whom with what".

**Two constraints this pins down (honest imperfection):**
- `flags.dnd5e.targets` is the roller's targets captured at roll time on the player's
  client. If the player rolled without targeting the boss, targets is empty and F5 falls to
  the plain line. `roll.type:"damage"` means damage was *rolled at* those targets, not that
  it hit or was applied. So attribution is a best-effort correlation and can miss; it must
  never assert a false killer where avoidable (hence uuid+window matching below).
- HP deltas + post-update timing dictate how `crossedToZero` is fed (below), and the
  overkill-on-a-corpse case must be probed before the re-fire guard is trusted.

## Data model

No new persistent documents or actor flags. Additions:

- **F4:** reads the raw stored tag flag for the trigger. Helper
  `isExplicitlyTagged(actor, "mob")` = `actor.getFlag(MODULE_ID, FLAGS.TAG) === "mob"`
  (confirmed to read the effective merged flag through an unlinked token's ActorDelta).
- **F5 last-damage-source record** - transient, GM-side, in-memory, not persisted. Shape:
  `{ attackerName: string, attackerUuid: string, itemName: string | null,
  targetUuids: string[], timestamp: number }`. Only a real damage card on a specific
  target updates it; a self-hit (`attackerUuid` equals a target) is filtered in pure logic.
- **World settings** (register in `settings.ts`):
  - `announceBossDeath: boolean` (default `true`).
  - `killAttributionWindowSeconds: number` (default `45`).

## Architecture

Three layers, matching the existing seam. New pure logic is unit-tested (TDD); the thin
adapter wiring is validated by the manual checklist. Death handling is NOT routed through
the combat-scoped `FoundryPort`/`TacticalInitiative` service - death fires per-actor
outside any combat context - so it lives in its own adapter file with a pure core.

### Pure logic (`src/logic/`, unit-tested, full JSDoc on every export)

- **`tag.ts`:** unchanged. F3 dropped, so `resolveTag(actorType, storedTag)` keeps its
  current signature and behavior.
- **`hp.ts` (new):** `hpTransition(resultingHp, changes) -> { previousHp, newHp }` with
  `previousHp = resultingHp - changes.hp`. Isolates the delta arithmetic for testing.
- **`death.ts` (new):** `crossedToZero(previousHp, newHp) -> boolean`, true only on a
  transition from >0 to <=0. (No `deathAction` selector - the two subscribers gate
  differently and inline; see the F4/F5 subscriber note.)
- **`kill-source.ts` (new):** the pure attribution reducer + selector, all id/uuid-based.
  - `nextSource(prev, event) -> Source | prev`. `event` carries
    `{ attackerName, attackerUuid, itemName, targetUuids, timestamp }`. Updates the record
    only for a real damage card, and never for a self-hit (`attackerUuid` in
    `event.targetUuids`) - the self-filter lives HERE, in tested pure logic.
  - `selectAttribution(source, deadActorUuid, now, windowMs) -> { attackerName, itemName }
    | null`. Returns the source only when `deadActorUuid` is in `source.targetUuids` AND
    `now - source.timestamp <= windowMs`; otherwise null (plain message). Matching is by
    UUID because dnd5e target descriptors are UUIDs and an unlinked actor's synthetic id
    is not the world id.
- **`kill-message.ts` (new):** `killMessageKey(bossName, attribution) -> { key, data }`,
  returning an i18n key + interpolation data (localized in the adapter, per the existing
  `announceDefaultMarch` pattern). Interpolation keys: `killer <- attackerName`,
  `boss <- bossName`, `weapon <- itemName`.
  - Attribution with item -> `Chat.BossKilled` ("{killer} has killed {boss} with their {weapon}").
  - Attribution, null item -> `Chat.BossKilledNoWeapon` ("{killer} has killed {boss}").
  - No attribution -> `Chat.BossDied` ("{boss} has fallen!") - a standalone dramatic line,
    since the fallback fires on a real share of kills (AoE, save-for-half, late apply).

Naming: the attacker is `attackerName` end to end; only the i18n layer maps it to `killer`.

### Adapter + wiring (`src/adapter/`, manual checklist)

- **`tags.ts` (extend):** add `isExplicitlyTagged(actor, tag)`. `readActorTag` unchanged.
- **`combat-events.ts` (new):** the single death/damage watcher, registered once at init on
  the elected active GM (reusing the existing `isActiveGM()` and `guard()` from `hooks.ts`).
  Detects death once and dispatches to subscribers rather than inlining F4/F5, so the B2
  tracker can subscribe later without re-hooking dnd5e. Exposes a typed in-module surface:
  `onActorDied(cb)` and a `lastDamageSource` accessor (not a public `module.api`).
  - **Attribution capture.** On `createChatMessage`, if `flags.dnd5e.roll?.type` is
    `"damage"` (damage cards only - an attack roll has not dealt damage yet), build the
    attacker UUID from `speaker` (scene/token/actor) so it matches the target descriptor
    format, read `flags.dnd5e.item.uuid`, and read `flags.dnd5e.targets[].uuid ?? .actor`
    (the field is renamed in a post-5.3 dnd5e), then feed `nextSource`. This runs GM-side
    because the card broadcasts. The exact flag reads are a manual-checklist probe.
  - **Death detection.** On `dnd5e.damageActor`, guard with the existing elected
    `isActiveGM()` - it fires on the active GM's client for any applier, so exactly one
    client acts and there is no duplicate-post risk. Compute `hpTransition` then
    `crossedToZero`; additionally skip if the actor is already at/below 0 before this change
    (independent re-fire guard - see the overkill probe). Fire the `actorDied(actor)`
    dispatch.
- **F4 subscriber:** on `actorDied`, if `isExplicitlyTagged(actor, "mob")` (the STORED tag,
  never the resolved default): hide the exact token(s) via
  `actor.getActiveTokens(false, true)` -> `token.update({ hidden: true })`, and delete the
  matching combatant resolved by **tokenId** (`token.combatant`), never by actorId (actorId
  matches live pack siblings). Removal goes through a named `removeMobFromCombat(tokenDoc)`
  helper so B1 (groups) can reinterpret it. On success, whisper the GM a one-click
  "Restore <name> to combat" chat link whose handler un-hides the token and re-creates the
  combatant (the inverse of removal) - the F4 undo.
- **F5 subscriber:** on `actorDied`, if the actor's resolved tag is `boss` AND
  `announceBossDeath` is on: build attribution via
  `selectAttribution(lastDamageSource, actor.uuid, now, windowMs)` (windowMs from
  `killAttributionWindowSeconds`), then `ChatMessage.create` (public) with the localized
  `killMessageKey(...)`.
  - Note the asymmetry, so no one "normalizes" it: F5 may use the RESOLVED tag because
    `resolveTag` never defaults anything to `boss`; F4 must use the EXPLICIT stored tag
    because `mob` IS the default for non-character actors. Making F4 use the resolved tag
    would auto-delete every untagged NPC at 0 HP - the exact behavior F4 forbids.
- **`hooks.ts` / `main.ts`:** export `isActiveGM` and `guard` (currently module-private) so
  `combat-events.ts` reuses both; register the watcher and the two settings at init.
- **`foundry-env.d.ts`:** add `uuid`, `isToken`, `token`, and
  `getActiveTokens(linked?, document?)` to the `FoundryActor` interface, plus the token
  `combatant` accessor, for the F4/F5 code.

## Manifest floor

This workstream introduces v14 + dnd5e-5.3-only paths, so `module.json` compatibility is
updated so the code never loads where it would throw. Recommendation for the plan: raise
`minimum` to `"14"` (the DM's table is v14-only and the module already sets
`verified: "14"`); the alternative is keep `"13"` and feature-detect
`game.release.generation >= 14`. Decide in the plan.

## F3 rationale (why it was dropped - upheld by both review rounds)

The two F3 decisions together (character owned-or-unowned -> `player`; non-character
player-owned -> `mob`) make the resolved tag depend ONLY on `type === "character"` -
byte-for-byte the module's current `resolveTag` default (`tag.ts:28-31`). `hasPlayerOwner`
would be a dead parameter, so F3 was dropped: no code. The only divergence from the DM's
ownership-worded intent is a player-owned NPC-type companion/summon, which resolves `mob`;
the DM can hand-tag such an actor `player` (a stored tag beats the default), so no F3 code
is needed for it either. Confirm at review that companions rolling as mobs by default is
acceptable.

## Error handling

- Every new hook body runs inside the existing `guard(label, body)` wrapper.
- All world mutation (`delete`, token `update`, `ChatMessage.create`) is elected-GM-only.
- A missing combatant/token/source is a no-op, never an error.

## Testing

- **Manual checklist - PROBES FIRST (run before dependent code is trusted):**
  1. `dnd5e.damageActor` delta semantics, including OVERKILL on a corpse: confirm
     `changes.hp` is clamped (0 further change) so the re-fire guard holds.
  2. The chat-card attribution flags: confirm `flags.dnd5e.item.uuid`,
     `flags.dnd5e.targets[].uuid`, `speaker.alias`, and `roll.type` on a live attack and a
     live damage card, GM-side, for a player's roll.
- **Manual checklist - behavior:**
  3. A creature explicitly tagged `mob` dropped to 0: only the token that died vanishes and
     hides; sibling unlinked mobs, and any UNtagged NPC, are untouched. The GM undo link
     restores it.
  4. An UNLINKED boss dropped to 0 by a player's targeted attack posts a public line
     naming that player + weapon (unlinked is the case where the attacker-UUID format
     matters; a linked-only test can false-pass).
  5. A boss killed by AoE / no target / late apply / manual HP edit posts the plain
     "{boss} has fallen!".
  6. A boss's own attack never credits the boss for its later death (uuid self-filter).
  7. `announceBossDeath` off suppresses F5 entirely; two connected GMs post the F5 line
     exactly once (elected-GM guard dedupe).
- **Unit (vitest, TDD):** `hpTransition` delta arithmetic (incl. temp-HP absorption where
  `changes.hp` is 0); `crossedToZero`; `nextSource` (records only real damage cards, drops
  self-hits by uuid); `selectAttribution` (uuid target-match + window); `killMessageKey`
  all three forms. (No `resolveTag` or `deathAction` tests - F3 dropped, `deathAction`
  removed.)

## i18n keys (add to `lang/en.json`)

- `TACTICAL_INITIATIVE.Chat.BossKilled` - "{killer} has killed {boss} with their {weapon}"
- `TACTICAL_INITIATIVE.Chat.BossKilledNoWeapon` - "{killer} has killed {boss}"
- `TACTICAL_INITIATIVE.Chat.BossDied` - "{boss} has fallen!"
- `TACTICAL_INITIATIVE.Chat.RestoreMob` - "Restore {name} to combat" (GM undo link)
- `TACTICAL_INITIATIVE.Chat.RestoreNoCombat` - warning when the origin combat is gone
- `TACTICAL_INITIATIVE.Settings.AnnounceBossDeath.Name` / `.Hint`
- `TACTICAL_INITIATIVE.Settings.KillAttributionWindow.Name` / `.Hint`

## Forward-compatibility notes (for B1/B2/C)

- `combat-events.ts` exposes `onActorDied` + `lastDamageSource` as a typed internal surface
  so B2's tracker subscribes to the derived death event instead of re-hooking dnd5e. No
  group-id flag is added here; B1 owns its own data model (the boss-slot linked-combatant
  pattern is the template).
- F4 removal is behind `removeMobFromCombat` so B1 can reinterpret "remove a grouped mob".
- Deferred to B2: should F5 boss-death also set the native `defeated` flag (so the existing
  `syncBossDefeat` greys the boss end-slot and B2 has one "dead" signal)? Not decided here.

## Out of scope (explicitly deferred)

- Any UI beyond chat + the undo whisper. Groups, the top-bar tracker, dice pools are
  separate workstreams.
- Heal-above-0 mob auto-restoration (the GM undo link is the manual path).
- Damage-amount weighting / multi-attacker disambiguation beyond uuid target + window.
- Setting the `defeated` flag on boss death (see forward-compat).
