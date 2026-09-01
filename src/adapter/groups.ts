/**
 * @file Group management against live Foundry documents: create/assign, rename,
 * recolor, remove, and disband native CombatantGroups. Not unit-tested (Foundry
 * boundary); covered by the manual checklist. Assumes it runs GM-side.
 */

import { FLAGS, MODULE_ID } from "../constants";

/** Default color for a new group tag. */
export const DEFAULT_GROUP_COLOR = "#8888ff";

/**
 * Add combatants to a group, creating a new group when `groupId` is `null`.
 *
 * @param combat - The combat that owns the combatants and groups.
 * @param combatantIds - The combatants to add.
 * @param groupId - An existing group id, or `null` to create a new group.
 */
export async function addToGroup(
  combat: FoundryCombat,
  combatantIds: readonly string[],
  groupId: string | null
): Promise<void> {
  if (combatantIds.length === 0) return;
  let targetId = groupId;
  if (targetId === null) {
    const name = game.i18n.format("TACTICAL_INITIATIVE.Group.DefaultName", {
      n: String(combat.groups.size + 1)
    });
    const created = (await combat.createEmbeddedDocuments("CombatantGroup", [
      { name, flags: { [MODULE_ID]: { [FLAGS.GROUP_COLOR]: DEFAULT_GROUP_COLOR } } }
    ])) as unknown as FoundryCombatantGroup[];
    const group = created[0];
    if (!group) return;
    targetId = group.id;
  }
  await combat.updateEmbeddedDocuments(
    "Combatant",
    combatantIds.map((id) => ({ _id: id, group: targetId }))
  );
}

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
    const group = combatant && typeof combatant.group === "string" ? combatant.group : null;
    if (group) affected.add(group);
  }
  await combat.updateEmbeddedDocuments(
    "Combatant",
    combatantIds.map((id) => ({ _id: id, group: null }))
  );
  for (const groupId of affected) {
    const stillHasMembers = combat.combatants.contents.some(
      (c) => (typeof c.group === "string" ? c.group : null) === groupId
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
    .filter((c) => (typeof c.group === "string" ? c.group : null) === groupId)
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
