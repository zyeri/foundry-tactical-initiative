/**
 * @file Pure grouping logic: partition combatants into native groups and the
 * ungrouped remainder. No Foundry globals, no side effects.
 */

import type { CombatantView } from "../types";

/** A single group and its members, plus the ungrouped remainder. */
export interface GroupPartition {
  /** Groups in first-seen encounter order. */
  groups: { groupId: string; members: CombatantView[] }[];
  /** Combatants not in any group. */
  ungrouped: CombatantView[];
}

/**
 * Split combatants into groups (keyed by `groupId`) and the ungrouped remainder,
 * preserving encounter order by each group's first-seen member.
 *
 * @param combatants - The combatants to partition.
 * @returns The {@link GroupPartition}.
 */
export function partitionByGroup(combatants: readonly CombatantView[]): GroupPartition {
  const ungrouped: CombatantView[] = [];
  const groups: { groupId: string; members: CombatantView[] }[] = [];
  const byId = new Map<string, { groupId: string; members: CombatantView[] }>();
  for (const combatant of combatants) {
    if (combatant.groupId === null) {
      ungrouped.push(combatant);
      continue;
    }
    let group = byId.get(combatant.groupId);
    if (!group) {
      group = { groupId: combatant.groupId, members: [] };
      byId.set(combatant.groupId, group);
      groups.push(group);
    }
    group.members.push(combatant);
  }
  return { groups, ungrouped };
}
