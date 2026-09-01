/**
 * @file The real {@link GroupControlPort}: binds the group control HUD's batch
 * actions to Foundry - canvas selection/targeting, dnd5e `applyDamage`, and
 * status-effect toggling. Foundry boundary: not unit-tested (the service that
 * drives it is). All mutations are elected-GM-only.
 */

import type { DamageInput, GroupControlPort, GroupMemberRef } from "../group-control-service";
import { isActiveGM } from "./hooks";

/** A {@link GroupControlPort} bound to one combat, reading groups from it live. */
export class FoundryGroupControlPort implements GroupControlPort {
  /**
   * @param combat - The combat whose groups this port operates on.
   */
  public constructor(private readonly combat: FoundryCombat) {}

  /**
   * The current members of a group, as {@link GroupMemberRef}s.
   *
   * @param groupId - The group id.
   * @returns The member refs (empty for an unknown or empty group).
   */
  public members(groupId: string): GroupMemberRef[] {
    return this.combat.combatants.contents
      .filter((combatant) => (typeof combatant.group === "string" ? combatant.group : null) === groupId)
      .map((combatant) => ({
        combatantId: combatant.id,
        tokenId: combatant.tokenId,
        actorId: combatant.actorId ?? "",
        name: combatant.actor?.name ?? ""
      }));
  }

  /**
   * Control (select) the given tokens on the canvas, replacing the prior
   * selection with the first and adding the rest.
   *
   * @param tokenIds - The token ids to select.
   */
  public async selectTokens(tokenIds: string[]): Promise<void> {
    if (!isActiveGM()) return;
    let releaseOthers = true;
    for (const id of tokenIds) {
      canvas.tokens?.get(id)?.control({ releaseOthers });
      releaseOthers = false;
    }
  }

  /**
   * Add the given tokens to the user's targets (existing targets are kept).
   *
   * @param tokenIds - The token ids to target.
   */
  public async targetTokens(tokenIds: string[]): Promise<void> {
    if (!isActiveGM()) return;
    for (const id of tokenIds) {
      canvas.tokens?.get(id)?.setTarget(true, { releaseOthers: false });
    }
  }

  /**
   * Apply damage (or healing when `isHealing`) to an actor via dnd5e
   * `applyDamage`, which respects resistances and immunities.
   *
   * @param actorId - The actor id.
   * @param input - The amount and direction.
   */
  public async applyDamage(actorId: string, input: DamageInput): Promise<void> {
    if (!isActiveGM()) return;
    const actor = game.actors?.get(actorId);
    if (!actor?.applyDamage) return;
    await actor.applyDamage(input.amount, { multiplier: input.isHealing === true ? -1 : 1 });
  }

  /**
   * Toggle a status/condition on a member's actor.
   *
   * @param member - The member.
   * @param statusId - The dnd5e status/condition id.
   * @param active - Whether to add (`true`) or remove (`false`) it.
   */
  public async setCondition(member: GroupMemberRef, statusId: string, active: boolean): Promise<void> {
    if (!isActiveGM()) return;
    const actor = game.actors?.get(member.actorId);
    if (!actor?.toggleStatusEffect) return;
    await actor.toggleStatusEffect(statusId, { active });
  }
}
