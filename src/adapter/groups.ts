/**
 * @file Group management against live Foundry documents: create/assign, rename,
 * recolor, remove, and disband native CombatantGroups. Not unit-tested (Foundry
 * boundary); covered by the manual checklist. Assumes it runs GM-side.
 */

import { FLAGS, MODULE_ID } from "../constants";
import { groupIdOf } from "../logic/group";
import { reconcileBossOnRetag } from "./boss-slots";

/** Default color for a new group tag. */
export const DEFAULT_GROUP_COLOR = "#8888ff";

/**
 * Remove combatants from their group, disbanding any group left empty.
 *
 * @param combat - The combat.
 * @param combatantIds - The combatants to remove from their groups.
 */
export async function removeFromGroup(
  combat: FoundryCombat,
  combatantIds: readonly string[]
): Promise<void> {
  const affected = new Set<string>();
  for (const id of combatantIds) {
    const combatant = combat.combatants.get(id);
    const group = combatant ? groupIdOf(combatant) : null;
    if (group) affected.add(group);
  }
  await combat.updateEmbeddedDocuments(
    "Combatant",
    combatantIds.map((id) => ({ _id: id, group: null }))
  );
  // A boss leaving a group regains its double-turn slots.
  for (const id of combatantIds) {
    const combatant = combat.combatants.get(id);
    if (combatant) await reconcileBossOnRetag(combatant, combat);
  }
  for (const groupId of affected) {
    const stillHasMembers = combat.combatants.contents.some(
      (c) => groupIdOf(c) === groupId
    );
    if (!stillHasMembers) await disbandGroup(combat, groupId);
  }
}

/**
 * Rename a group.
 *
 * @param combat - The combat.
 * @param groupId - The group id.
 * @param name - The new name.
 */
export async function renameGroup(combat: FoundryCombat, groupId: string, name: string): Promise<void> {
  await combat.groups.get(groupId)?.update({ name });
}

/**
 * Set a group's tag color.
 *
 * @param combat - The combat.
 * @param groupId - The group id.
 * @param color - A CSS color string.
 */
export async function recolorGroup(combat: FoundryCombat, groupId: string, color: string): Promise<void> {
  await combat.groups.get(groupId)?.setFlag(MODULE_ID, FLAGS.GROUP_COLOR, color);
}

/**
 * Disband a group: clear each member's group, restore any former member's boss
 * double-turn slots (same as {@link removeFromGroup}), then delete the group
 * document.
 *
 * @param combat - The combat.
 * @param groupId - The group id.
 */
export async function disbandGroup(combat: FoundryCombat, groupId: string): Promise<void> {
  const memberIds = combat.combatants.contents
    .filter((c) => groupIdOf(c) === groupId)
    .map((c) => c.id);
  if (memberIds.length > 0) {
    await combat.updateEmbeddedDocuments(
      "Combatant",
      memberIds.map((id) => ({ _id: id, group: null }))
    );
  }
  // A boss whose group is disbanded regains its double-turn slots.
  for (const id of memberIds) {
    const combatant = combat.combatants.get(id);
    if (combatant) await reconcileBossOnRetag(combatant, combat);
  }
  await combat.deleteEmbeddedDocuments("CombatantGroup", [groupId]);
}

/**
 * Read a group's tag color, falling back to the default.
 *
 * @param group - The group document.
 * @returns The color string.
 */
export function groupColor(group: FoundryCombatantGroup): string {
  const color = group.getFlag(MODULE_ID, FLAGS.GROUP_COLOR);
  return typeof color === "string" ? color : DEFAULT_GROUP_COLOR;
}

/**
 * Combat-id:group-id pairs with a {@link sweepEmptyGroup} delete in flight, so
 * concurrent calls for the same group (e.g. a batch combatant delete firing the
 * deleteCombatant hook once per member) don't race to delete the same
 * CombatantGroup document twice.
 */
const sweepInFlight = new Set<string>();

/**
 * Delete one group if it now has no members left, after a single combatant is
 * deleted (by manual delete, F4 mob cleanup, or core token cleanup). A no-op for
 * `null`, for a group id that no longer exists, or for a group that still has a
 * member. Dedupes concurrent calls for the same group with {@link sweepInFlight}
 * so a batch delete (which fires the deleteCombatant hook once per combatant)
 * cannot try to delete the same group document more than once.
 *
 * @param combat - The combat.
 * @param groupId - The deleted combatant's group id (read before the delete, since
 *   the document still carries it), or `null` if it had no group.
 */
export async function sweepEmptyGroup(combat: FoundryCombat, groupId: string | null): Promise<void> {
  if (groupId === null) return;
  if (!combat.groups.get(groupId)) return;
  const key = `${combat.id}:${groupId}`;
  if (sweepInFlight.has(key)) return;
  sweepInFlight.add(key);
  try {
    const stillHasMembers = combat.combatants.contents.some((c) => groupIdOf(c) === groupId);
    if (stillHasMembers) return;
    if (!combat.groups.get(groupId)) return;
    await combat.deleteEmbeddedDocuments("CombatantGroup", [groupId]);
  } finally {
    sweepInFlight.delete(key);
  }
}
