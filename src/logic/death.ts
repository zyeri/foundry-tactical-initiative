/**
 * @file Pure death-detection predicate. No Foundry globals, no side effects.
 */

/**
 * Whether a hit-point change crossed an actor from alive to dropped.
 *
 * @param previousHp - Hit points before the change.
 * @param newHp - Hit points after the change.
 * @returns `true` only for a transition from above 0 to 0 or below.
 */
export function crossedToZero(previousHp: number, newHp: number): boolean {
  return previousHp > 0 && newHp <= 0;
}
