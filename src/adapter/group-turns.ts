/**
 * @file Makes a combatant group take one turn: a preUpdateCombat hook rewrites
 * the pending turn with the pure adjustTurn rule, and a sort tie-break keeps a
 * group's members adjacent. Works for any tracker that advances turns through
 * Combat#nextTurn / #previousTurn / update({turn}). Foundry boundary: the rules
 * are tested in test/turns.test.ts; this wiring is on the README checklist.
 */

import { MODULE_ID } from "../constants";
import { groupIdOf } from "../logic/group";
import { adjustTurn, groupTieBreak, type TurnRef } from "../logic/turns";
import { guard } from "./hooks";

/** Marker so the sort method is wrapped once. */
const SORT_PATCHED = "__tacticalInitiativeGroupSortPatched";

/** Wrap Combat#_sortCombatants with the group tie-break (best effort). */
function patchSort(): void {
  const proto = (CONFIG as unknown as { Combat?: { documentClass?: { prototype?: Record<string, unknown> } } })
    .Combat?.documentClass?.prototype;
  if (!proto || proto[SORT_PATCHED] === true) return;
  const original = proto["_sortCombatants"];
  if (typeof original !== "function") {
    console.warn(`${MODULE_ID} | Combat#_sortCombatants not found; group members may interleave on ties`);
    return;
  }
  const sort = original as (this: unknown, a: FoundryCombatant, b: FoundryCombatant) => number;
  proto["_sortCombatants"] = function (this: unknown, a: FoundryCombatant, b: FoundryCombatant): number {
    const tie = groupTieBreak(
      { initiative: a.initiative, groupId: groupIdOf(a) },
      { initiative: b.initiative, groupId: groupIdOf(b) }
    );
    return tie !== 0 ? tie : sort.call(this, a, b);
  };
  proto[SORT_PATCHED] = true;
}

/** Register the turn-skip hook and the sort tie-break. Call at `init`. */
export function registerGroupTurns(): void {
  Hooks.once("setup", patchSort);
  Hooks.on(
    "preUpdateCombat",
    (
      combat: FoundryCombat,
      changes: { turn?: unknown; round?: unknown },
      options: { direction?: number } & Record<string, unknown>
    ): boolean | void => {
      if (typeof changes.turn !== "number") return;
      if (typeof changes.round === "number" && changes.round > combat.round) return;
      const marker = options[MODULE_ID];
      if (marker && typeof marker === "object" && (marker as { resetTurn?: unknown }).resetTurn === true) return;
      const from = combat.turn;
      let direction: 1 | -1;
      if (options.direction === -1 || options.direction === 1) {
        direction = options.direction;
      } else if (changes.turn === (from ?? -1) + 1) {
        direction = 1;
      } else if (changes.turn === (from ?? -1) - 1) {
        direction = -1;
      } else {
        // Direction-less, non-adjacent change (e.g. a reset update to the same
        // or an arbitrary index): leave it untouched rather than misreading it
        // as a step.
        return;
      }
      const turns: TurnRef[] = combat.turns.map((c) => ({
        id: c.id,
        groupId: groupIdOf(c),
        defeated: c.isDefeated
      }));
      const result = adjustTurn(turns, from, changes.turn, direction, combat.settings?.skipDefeated === true);
      if (result.kind === "set") changes.turn = result.turn;
      if (result.kind === "nextRound") {
        guard("group next round", async () => {
          await combat.nextRound();
        });
        return false;
      }
    }
  );
}
