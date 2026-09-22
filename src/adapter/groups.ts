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
 * Disband a group: clear each member's group, then delete the group document.
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
 * Delete every group in the combat that has no members left (after a combatant
 * is deleted by F4 mob cleanup, a manual delete, or core token cleanup).
 *
 * @param combat - The combat.
 */
export async function sweepEmptyGroups(combat: FoundryCombat): Promise<void> {
  const used = new Set(combat.combatants.contents.map((c) => groupIdOf(c)));
  const empty = combat.groups.contents.filter((group) => !used.has(group.id)).map((group) => group.id);
  if (empty.length > 0) await combat.deleteEmbeddedDocuments("CombatantGroup", empty);
}
