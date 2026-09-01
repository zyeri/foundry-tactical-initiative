/**
 * @file The real {@link FoundryPort} implementation, binding the orchestration
 * service to live FoundryVTT v13 + dnd5e documents. Each instance is bound to one
 * combat. This layer is not unit-tested; it is covered by the README manual
 * checklist and the assumptions log (see README "Assumptions").
 */

import { FLAGS, MODULE_ID, V14_GENERATION, type Choice } from "../constants";
import { effectChangesFor, toV14Changes } from "../logic/effects";
import type { CombatantView, FoundryPort } from "../types";
import { requestChoiceFromOwner } from "./player-query";
import { readCombatantTag } from "./tags";

/** Icons shown on the token while a temporary initiative effect is active. */
const EFFECT_ICON: Readonly<Record<Exclude<Choice, "march">, string>> = {
  rush: "icons/svg/downgrade.svg",
  hunker: "icons/svg/upgrade.svg"
};

/**
 * Binds the initiative service to a single live combat.
 */
export class FoundryAdapter implements FoundryPort {
  /**
   * @param combat - The combat this adapter operates on.
   * @param timeoutMs - Player-choice timeout in milliseconds.
   */
  public constructor(
    private readonly combat: FoundryCombat,
    private readonly timeoutMs: number
  ) {}

  /**
   * Resolve a combatant in this combat by id.
   *
   * @param combatantId - The combatant id.
   * @returns The combatant document.
   * @throws When no such combatant exists in this combat.
   */
  private combatant(combatantId: string): FoundryCombatant {
    const found = this.combat.combatants.get(combatantId);
    if (!found) throw new Error(`${MODULE_ID}: combatant ${combatantId} not found`);
    return found;
  }

  /**
   * Resolve an actor by id via the world actors collection.
   *
   * @param actorId - The actor id.
   * @returns The actor, or `null` when not found.
   */
  private actor(actorId: string): FoundryActor | null {
    return game.actors?.get(actorId) ?? null;
  }

  public async listCombatants(_combatId: string): Promise<CombatantView[]> {
    return this.combat.combatants.contents.map((combatant): CombatantView => {
      const slot = combatant.getFlag(MODULE_ID, FLAGS.BOSS_SLOT);
      const order = combatant.getFlag(MODULE_ID, FLAGS.BOSS_ORDER);
      const isBossSlot = slot === "start" || slot === "end";
      return {
        id: combatant.id,
        actorId: combatant.actorId ?? "",
        actorName: combatant.actor?.name ?? "",
        tag: readCombatantTag(combatant),
        isDefeated: combatant.isDefeated,
        bossSlot: isBossSlot ? slot : null,
        bossRank: isBossSlot && typeof order === "number" ? order : null,
        groupId: typeof combatant.group === "string" && combatant.group ? combatant.group : null
      };
    });
  }

  public async clearInitiative(combatantId: string): Promise<void> {
    await this.combatant(combatantId).update({ initiative: null });
  }

  public async removeTempEffects(actorId: string): Promise<void> {
    const actor = this.actor(actorId);
    if (!actor) return;
    const ids = actor.effects
      .filter((effect) => effect.getFlag(MODULE_ID, FLAGS.TEMP_EFFECT) === true)
      .map((effect) => effect.id);
    if (ids.length > 0) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }

  public async applyEffect(actorId: string, choice: Choice): Promise<void> {
    const changes = effectChangesFor(choice);
    if (changes.length === 0) return; // march: no effect
    const actor = this.actor(actorId);
    if (!actor) return;
    const label = game.i18n.localize(`TACTICAL_INITIATIVE.Effect.${choice === "rush" ? "Rush" : "Hunker"}`);
    const base = {
      name: label,
      img: EFFECT_ICON[choice === "rush" ? "rush" : "hunker"],
      origin: actor.uuid,
      disabled: false,
      flags: { [MODULE_ID]: { [FLAGS.TEMP_EFFECT]: true } }
    };
    // Foundry v14 moved effect changes from the document root (numeric `mode`) to
    // `system.changes` (string `type`). Emit the shape the running core expects.
    const data =
      (game.release?.generation ?? 0) >= V14_GENERATION
        ? { ...base, system: { changes: toV14Changes(changes) } }
        : { ...base, changes };
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  }

  public async rollInitiativeValue(combatantId: string): Promise<number> {
    const combatant = this.combatant(combatantId);
    const roll = this.buildInitiativeRoll(combatant);
    await roll.evaluate();
    return roll.total;
  }

  /**
   * Build the combatant's initiative Roll using dnd5e's own builder so init
   * bonuses, the Alert feat, and situational modifiers are respected. Falls back
   * progressively if a builder is unavailable.
   *
   * @param combatant - The combatant to roll for.
   * @returns An unevaluated {@link FoundryRoll}.
   */
  private buildInitiativeRoll(combatant: FoundryCombatant): FoundryRoll {
    if (typeof combatant.getInitiativeRoll === "function") return combatant.getInitiativeRoll();
    const actor = combatant.actor;
    if (actor && typeof actor.getInitiativeRoll === "function") return actor.getInitiativeRoll();
    const data = actor?.getRollData?.() ?? {};
    return new Roll("1d20 + @attributes.init.total", data);
  }

  public async setInitiative(combatantId: string, value: number): Promise<void> {
    await this.combatant(combatantId).update({ initiative: value });
  }

  public async requestPlayerChoice(combatantId: string): Promise<Choice | null> {
    return requestChoiceFromOwner(this.combatant(combatantId), this.timeoutMs);
  }

  public async markChoosing(combatantId: string, choosing: boolean): Promise<void> {
    await this.combatant(combatantId).update({
      [`flags.${MODULE_ID}.${FLAGS.CHOOSING}`]: choosing
    });
  }

  public async announceDefaultMarch(actorName: string): Promise<void> {
    const content = game.i18n.format("TACTICAL_INITIATIVE.Chat.DefaultedToMarch", { name: actorName });
    await ChatMessage.create({ content });
  }

  public async rollGroupInitiative(groupId: string): Promise<number> {
    // Roll once using a representative member so init bonuses apply, then share it.
    const member = this.combat.combatants.find(
      (c) => (typeof c.group === "string" ? c.group : null) === groupId
    );
    if (!member) return 0;
    const roll = this.buildInitiativeRoll(member);
    await roll.evaluate();
    return roll.total;
  }

  public async groupInitiativeValue(groupId: string): Promise<number | null> {
    const group = this.combat.groups.get(groupId);
    return group && typeof group.initiative === "number" ? group.initiative : null;
  }
}
