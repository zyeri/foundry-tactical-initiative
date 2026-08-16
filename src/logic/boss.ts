/**
 * @file Pure boss-slot ordering logic. No Foundry globals, no side effects.
 */

import { BOSS_END_BASE, BOSS_START_BASE, type BossSlot } from "../constants";

/**
 * Compute the initiative value for a boss slot.
 *
 * Start slots use `BOSS_START_BASE - rank` so they sort above any normal d20
 * roll; end slots use `BOSS_END_BASE - rank` so they sort below any normal roll.
 * Subtracting the same `rank` from both means multiple bosses keep an identical
 * relative order at the start and at the end (Foundry sorts initiative
 * descending, so a lower rank yields a higher value and thus sorts first).
 *
 * @param slot - Which boss turn this entry represents.
 * @param rank - The boss's stable ordering rank (0-based).
 * @returns The initiative value to assign the slot's combatant.
 */
export function bossSlotInitiative(slot: BossSlot, rank: number): number {
  const base = slot === "start" ? BOSS_START_BASE : BOSS_END_BASE;
  return base - rank;
}
