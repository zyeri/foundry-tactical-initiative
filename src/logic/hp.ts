/**
 * @file Pure HP-transition arithmetic for the dnd5e `damageActor` hook, which
 * reports signed deltas and fires after the update is applied. No Foundry globals.
 */

/** The `changes` payload of `dnd5e.damageActor`: signed deltas, not resulting values. */
export interface HpChanges {
  /** Signed change to hit points (negative on damage). */
  hp: number;
  /** Signed change to temporary hit points. */
  temp: number;
  /** Summed signed change to hit points. */
  total: number;
}

/** A before/after pair of hit-point values. */
export interface HpTransition {
  /** Hit points immediately before this change. */
  previousHp: number;
  /** Hit points immediately after this change. */
  newHp: number;
}

/**
 * Reconstruct the before/after hit points from the post-update value and the
 * signed delta the `dnd5e.damageActor` hook reports.
 *
 * @param resultingHp - The actor's hit points after the update (already applied).
 * @param changes - The hook's signed-delta payload.
 * @returns The previous and new hit points.
 */
export function hpTransition(resultingHp: number, changes: HpChanges): HpTransition {
  return { previousHp: resultingHp - changes.hp, newHp: resultingHp };
}
