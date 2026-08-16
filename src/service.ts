/**
 * @file The tag-based initiative orchestration service. It depends only on the
 * {@link FoundryPort} interface, never on Foundry directly, so its full flow is
 * unit-tested against an in-memory fake port.
 */

import type { Choice } from "./constants";
import { bossSlotInitiative } from "./logic/boss";
import { initiativeAdjustment, normalizeChoice } from "./logic/initiative";
import type { CombatantView, FoundryPort } from "./types";

/**
 * Drives the per-tag initiative behavior for a combat.
 */
export class TacticalInitiative {
  /**
   * @param port - The Foundry seam used for all side effects.
   */
  public constructor(private readonly port: FoundryPort) {}

  /**
   * Reroll initiative for an entire combat: clear all existing values and temp
   * effects, then apply each combatant's tag behavior. Called at combat start
   * and at the start of every new round.
   *
   * @param combatId - The combat document id.
   */
  public async rollForCombat(combatId: string): Promise<void> {
    const combatants = await this.port.listCombatants(combatId);

    // Reset pass: remove prior effects and clear initiative for everyone.
    for (const combatant of combatants) {
      await this.port.removeTempEffects(combatant.actorId);
      await this.port.clearInitiative(combatant.id);
    }

    const active = combatants.filter((c) => !c.isDefeated);
    const choices = await this.gatherPlayerChoices(active);
    for (const combatant of active) {
      await this.applyCombatant(combatant, choices.get(combatant.id));
    }
  }

  /**
   * Roll initiative for a single combatant using its tag behavior. Used when a
   * combatant joins mid-round; does not reset the rest of the combat.
   *
   * @param combatId - The combat document id.
   * @param combatantId - The joining combatant's id.
   */
  public async rollForCombatant(combatId: string, combatantId: string): Promise<void> {
    const combatants = await this.port.listCombatants(combatId);
    const combatant = combatants.find((c) => c.id === combatantId);
    if (!combatant || combatant.isDefeated) return;
    const choices = await this.gatherPlayerChoices([combatant]);
    await this.applyCombatant(combatant, choices.get(combatant.id));
  }

  /**
   * Ask every player combatant (concurrently) for its choice, showing the
   * "choosing" indicator during the prompt. A `null` answer (offline or timeout)
   * defaults to March and posts a chat note.
   *
   * @param active - The non-defeated combatants to consider.
   * @returns A map of combatant id to resolved {@link Choice}.
   */
  private async gatherPlayerChoices(active: readonly CombatantView[]): Promise<Map<string, Choice>> {
    const players = active.filter((c) => c.tag === "player");
    const entries = await Promise.all(
      players.map(async (combatant): Promise<readonly [string, Choice]> => {
        await this.port.markChoosing(combatant.id, true);
        const raw = await this.port.requestPlayerChoice(combatant.id);
        await this.port.markChoosing(combatant.id, false);
        if (raw === null) {
          await this.port.announceDefaultMarch(combatant.actorName);
          return [combatant.id, "march"];
        }
        return [combatant.id, normalizeChoice(raw)];
      })
    );
    return new Map(entries);
  }

  /**
   * Apply a single combatant's tag behavior: set a boss slot's fixed value, roll
   * a mob normally, or apply a player's effect and adjusted roll.
   *
   * @param combatant - The combatant to process.
   * @param choice - The player's resolved choice, if any (players only).
   */
  private async applyCombatant(combatant: CombatantView, choice: Choice | undefined): Promise<void> {
    switch (combatant.tag) {
      case "boss": {
        if (combatant.bossSlot === null || combatant.bossRank === null) return;
        await this.port.setInitiative(combatant.id, bossSlotInitiative(combatant.bossSlot, combatant.bossRank));
        return;
      }
      case "mob": {
        const value = await this.port.rollInitiativeValue(combatant.id);
        await this.port.setInitiative(combatant.id, value);
        return;
      }
      case "player": {
        const resolved = choice ?? "march";
        await this.port.applyEffect(combatant.actorId, resolved);
        const base = await this.port.rollInitiativeValue(combatant.id);
        await this.port.setInitiative(combatant.id, base + initiativeAdjustment(resolved));
        return;
      }
    }
  }
}
