/**
 * @file Boss double-turn lifecycle: a boss-tagged actor gets two combatant
 * entries - a "start" slot sorted above every roll and an "end" slot sorted
 * below every roll. This module creates, orders, syncs, and tears down that pair.
 * All functions assume they run GM-side.
 */

import { FLAGS, MODULE_ID } from "../constants";
import { bossSlotInitiative } from "../logic/boss";
import { readCombatantTag } from "./tags";

/**
 * Read a combatant's boss slot flag.
 *
 * @param combatant - The combatant.
 * @returns `"start"`, `"end"`, or `null` when not a boss slot.
 */
function slotOf(combatant: FoundryCombatant): "start" | "end" | null {
  const value = combatant.getFlag(MODULE_ID, FLAGS.BOSS_SLOT);
  return value === "start" || value === "end" ? value : null;
}

/**
 * Read a combatant's stable boss ordering rank.
 *
 * @param combatant - The combatant.
 * @returns The rank, or `0` when unset.
 */
function rankOf(combatant: FoundryCombatant): number {
  const value = combatant.getFlag(MODULE_ID, FLAGS.BOSS_ORDER);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Find the end slot paired to a given start-slot (primary) combatant.
 *
 * @param combat - The combat to search.
 * @param primaryId - The primary combatant's id.
 * @returns The paired end-slot combatant, or `undefined`.
 */
function findEndSlot(combat: FoundryCombat, primaryId: string): FoundryCombatant | undefined {
  return combat.combatants.find((c) => c.getFlag(MODULE_ID, FLAGS.PRIMARY_ID) === primaryId);
}

/**
 * The next unused boss rank in a combat (max existing start-slot rank + 1).
 *
 * @param combat - The combat.
 * @returns A rank not currently used by any start slot.
 */
function nextBossRank(combat: FoundryCombat): number {
  const ranks = combat.combatants.contents
    .filter((c) => slotOf(c) === "start")
    .map((c) => rankOf(c));
  return ranks.length > 0 ? Math.max(...ranks) + 1 : 0;
}

/**
 * Given a freshly created combatant, if its actor is a boss and it is not itself
 * a module-created slot, promote it to the "start" slot and create its paired
 * "end" slot. The recursion guard is the boss-slot flag: the created end slot
 * carries `bossSlot: "end"`, so this function skips it when its own
 * `createCombatant` fires.
 *
 * @param combatant - The newly created combatant.
 * @param combat - The combat it belongs to.
 */
export async function setupBossCombatant(
  combatant: FoundryCombatant,
  combat: FoundryCombat
): Promise<void> {
  if (readCombatantTag(combatant) !== "boss") return;
  if (slotOf(combatant) !== null) return; // already a slot (guards recursion)
  // Grouped combatants share one initiative and skip the double-turn (B1).
  if (typeof combatant.group === "string" && combatant.group) return;

  const rank = nextBossRank(combat);
  await combatant.update({
    initiative: bossSlotInitiative("start", rank),
    [`flags.${MODULE_ID}.${FLAGS.BOSS_SLOT}`]: "start",
    [`flags.${MODULE_ID}.${FLAGS.BOSS_ORDER}`]: rank
  });

  await combat.createEmbeddedDocuments("Combatant", [
    {
      tokenId: combatant.tokenId,
      actorId: combatant.actorId,
      sceneId: combatant.sceneId,
      initiative: bossSlotInitiative("end", rank),
      flags: {
        [MODULE_ID]: {
          [FLAGS.BOSS_SLOT]: "end",
          [FLAGS.PRIMARY_ID]: combatant.id,
          [FLAGS.BOSS_ORDER]: rank
        }
      }
    }
  ]);
}

/**
 * When a boss combatant entry is deleted, delete its partner too. Existence
 * checks prevent infinite recursion: by the time a deletion hook fires, the
 * deleted entry is already gone, so the partner's own deletion finds nothing to
 * delete on its second pass.
 *
 * @param deleted - The combatant that was just deleted.
 * @param combat - The combat it belonged to.
 */
export async function cleanupBossPairOnDelete(
  deleted: FoundryCombatant,
  combat: FoundryCombat
): Promise<void> {
  const slot = slotOf(deleted);
  if (slot === "start") {
    const end = findEndSlot(combat, deleted.id);
    if (end) await end.delete();
    return;
  }
  if (slot === "end") {
    const primaryId = deleted.getFlag(MODULE_ID, FLAGS.PRIMARY_ID);
    const primary = typeof primaryId === "string" ? combat.combatants.get(primaryId) : undefined;
    if (primary) await primary.delete();
  }
}

/**
 * Mirror a start-slot boss's defeated state onto its paired end slot so both
 * entries are skipped together (with the "Skip Defeated" combat setting on).
 *
 * @param combatant - The updated combatant.
 * @param combat - The combat it belongs to.
 */
export async function syncBossDefeat(
  combatant: FoundryCombatant,
  combat: FoundryCombat
): Promise<void> {
  if (slotOf(combatant) !== "start") return;
  const end = findEndSlot(combat, combatant.id);
  if (end && end.isDefeated !== combatant.isDefeated) {
    await end.update({ defeated: combatant.isDefeated });
  }
}

/**
 * Ensure a combatant that was just retagged has boss slots iff it is now a boss:
 * create the pair when it became a boss, or delete the end slot and clear the
 * start flags when it stopped being one.
 *
 * @param combatant - The retagged combatant (the start slot / natural entry).
 * @param combat - The combat it belongs to.
 */
export async function reconcileBossOnRetag(
  combatant: FoundryCombatant,
  combat: FoundryCombat
): Promise<void> {
  const isBoss = readCombatantTag(combatant) === "boss";
  const slot = slotOf(combatant);

  if (isBoss && slot === null) {
    await setupBossCombatant(combatant, combat);
    return;
  }
  if (!isBoss && slot === "start") {
    const end = findEndSlot(combat, combatant.id);
    if (end) await end.delete();
    await combatant.update({
      [`flags.${MODULE_ID}.-=${FLAGS.BOSS_SLOT}`]: null,
      [`flags.${MODULE_ID}.-=${FLAGS.BOSS_ORDER}`]: null
    });
  }
}
