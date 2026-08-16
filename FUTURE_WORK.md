# Future Work

## Full Foundry mock harness (planned)

The current test suite covers the **pure logic** and the **orchestration layer**
(the `TacticalInitiative` service driven through the `FoundryPort` interface against a
small in-memory fake — see `test/fake-port.ts`). The thin adapter that binds
`FoundryPort` to the real FoundryVTT/dnd5e APIs (`src/adapter/foundry-adapter.ts`) is
**not** unit-tested; it is validated by the manual test checklist in the README.

The goal of this work item is to replace that gap with a **full in-memory Foundry mock
harness** so the adapter and hook wiring can run under vitest end-to-end.

### Scope

Fake the subset of the Foundry v13 + dnd5e runtime the module touches:

| Global / class | Members the module uses | Mock responsibility |
|---|---|---|
| `game` | `settings.get/register`, `users`, `user`, `users.activeGM`, `i18n.localize/format` | in-memory settings store, user registry, active-GM election |
| `Hooks` | `on`, `once`, `callAll`, `call` | synchronous event dispatcher with handler registry |
| `CONFIG.queries` | assignment + lookup | registry the fake `User#query` dispatches through |
| `User` | `isGM`, `active`, `id`, `query(name, data, {timeout})` | resolve via `CONFIG.queries`; simulate timeout + offline |
| `Actor` | `type`, `uuid`, `get/setFlag`, `createEmbeddedDocuments`, `deleteEmbeddedDocuments`, `effects`, `testUserPermission` | in-memory embedded-document collections |
| `ActiveEffect` | `create`/`delete`, `changes`, `flags`, `disabled` | plain records in the actor's `effects` collection |
| `Combat` | `combatants`, `started`, `round`, `rollInitiative`, `setInitiative` | in-memory tracker; `rollInitiative` writes a deterministic value (seeded RNG) |
| `Combatant` | `id`, `actor`, `initiative`, `players`, `isDefeated`, `get/setFlag`, `update`, `delete` | linked to fake actors; emit create/update/delete hooks |
| `DialogV2` | `wait` / button actions | resolve to a scripted choice or simulate no-answer |
| `ChatMessage` | `create` | capture posted messages for assertions |
| `ui.notifications` | `warn`/`info` | capture for assertions |

### Deliverables

1. `test/harness/` — the in-memory fakes above, each emitting the same hooks real
   Foundry emits (`createCombatant`, `combatStart`, `combatRound`, `deleteCombat`, …).
2. A seeded RNG so `rollInitiative` results are deterministic in tests.
3. End-to-end tests exercising the real hook handlers in `src/adapter`:
   - combat start rolls every tag correctly and posts the right chat notes;
   - round 2 clears initiative and rerolls, removing prior effects;
   - boss join creates paired start/end combatants; retag/removal cleans them up;
   - player-offline and timeout both fall back to March with a chat note;
   - combat end removes all module-created effects and duplicate boss combatants.

### Known risk

A mock validates the module against *our model* of Foundry, not the real engine. Keep
the manual checklist authoritative for the exact API seams (does `rollInitiative`
actually populate `initiative`? does dnd5e apply the AE bonus keys?). The harness is a
regression net for the module's own logic, not a substitute for one smoke test in a
live world per Foundry/dnd5e upgrade.
