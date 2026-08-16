/**
 * @file Small cross-combat lookup helpers used by the wiring layer.
 */

/** A combatant together with the combat that owns it. */
export interface CombatantLocation {
  /** The owning combat. */
  combat: FoundryCombat;
  /** The combatant document. */
  combatant: FoundryCombatant;
}

/**
 * Find a combatant by id across all combats.
 *
 * @param combatantId - The combatant id.
 * @returns Its location, or `null` when not found.
 */
export function findCombatant(combatantId: string): CombatantLocation | null {
  for (const combat of game.combats?.contents ?? []) {
    const combatant = combat.combatants.get(combatantId);
    if (combatant) return { combat, combatant };
  }
  return null;
}
