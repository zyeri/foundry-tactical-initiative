/**
 * @file The group control HUD's batch actions, orchestrated behind the
 * {@link GroupControlPort} seam so the flow is unit-tested against a fake. The
 * real Foundry binding (canvas selection, targeting, dnd5e applyDamage, status
 * effects) lives in the adapter.
 */

/** A group member reduced to what the batch actions need. */
export interface GroupMemberRef {
  /** The combatant document id. */
  combatantId: string;
  /** The token document id, or `null` when the member has no scene token. */
  tokenId: string | null;
  /** The actor id. */
  actorId: string;
  /** Display name. */
  name: string;
}

/** Damage or healing to apply to a member. */
export interface DamageInput {
  /** The amount (always positive; `isHealing` sets direction). */
  amount: number;
  /** The dnd5e damage type, if any. */
  type?: string;
  /** When true, heal instead of damage. */
  isHealing?: boolean;
}

/** The seam between {@link GroupControlService} and Foundry. */
export interface GroupControlPort {
  /** The group's current members. */
  members(groupId: string): GroupMemberRef[];
  /** Select the given tokens on the canvas. */
  selectTokens(tokenIds: string[]): Promise<void>;
  /** Set the given tokens as the user's targets. */
  targetTokens(tokenIds: string[]): Promise<void>;
  /** Apply damage or healing to an actor (respecting its resistances). */
  applyDamage(actorId: string, input: DamageInput): Promise<void>;
  /** Toggle a status/condition on a member. */
  setCondition(member: GroupMemberRef, statusId: string, active: boolean): Promise<void>;
}

/** Runs the HUD's four batch actions over a group's members. */
export class GroupControlService {
  /**
   * @param port - The Foundry seam.
   */
  public constructor(private readonly port: GroupControlPort) {}

  /**
   * Select every member token on the canvas (members without a token are skipped).
   *
   * @param groupId - The group id.
   */
  public async selectAll(groupId: string): Promise<void> {
    await this.port.selectTokens(this.tokenIds(groupId));
  }

  /**
   * Target every member token.
   *
   * @param groupId - The group id.
   */
  public async targetAll(groupId: string): Promise<void> {
    await this.port.targetTokens(this.tokenIds(groupId));
  }

  /**
   * Apply damage or healing to every member actor.
   *
   * @param groupId - The group id.
   * @param input - The damage/healing to apply.
   */
  public async applyToAll(groupId: string, input: DamageInput): Promise<void> {
    for (const member of this.port.members(groupId)) {
      await this.port.applyDamage(member.actorId, input);
    }
  }

  /**
   * Toggle a condition on every member.
   *
   * @param groupId - The group id.
   * @param statusId - The dnd5e status/condition id.
   * @param active - Whether to add (`true`) or remove (`false`) it.
   */
  public async setConditionAll(groupId: string, statusId: string, active: boolean): Promise<void> {
    for (const member of this.port.members(groupId)) {
      await this.port.setCondition(member, statusId, active);
    }
  }

  /** Token ids of members that have a token. */
  private tokenIds(groupId: string): string[] {
    return this.port
      .members(groupId)
      .map((member) => member.tokenId)
      .filter((id): id is string => id !== null);
  }
}
