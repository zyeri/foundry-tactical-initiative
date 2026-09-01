import type {
  DamageInput,
  GroupControlPort,
  GroupMemberRef
} from "../src/group-control-service";

/** In-memory GroupControlPort recording each side effect for assertions. */
export class FakeGroupControlPort implements GroupControlPort {
  public membersByGroup = new Map<string, GroupMemberRef[]>();
  public selected: string[][] = [];
  public targeted: string[][] = [];
  public damaged: { actorId: string; input: DamageInput }[] = [];
  public conditions: { member: GroupMemberRef; statusId: string; active: boolean }[] = [];

  public members(groupId: string): GroupMemberRef[] {
    return this.membersByGroup.get(groupId) ?? [];
  }
  public async selectTokens(tokenIds: string[]): Promise<void> {
    this.selected.push(tokenIds);
  }
  public async targetTokens(tokenIds: string[]): Promise<void> {
    this.targeted.push(tokenIds);
  }
  public async applyDamage(actorId: string, input: DamageInput): Promise<void> {
    this.damaged.push({ actorId, input });
  }
  public async setCondition(member: GroupMemberRef, statusId: string, active: boolean): Promise<void> {
    this.conditions.push({ member, statusId, active });
  }
}
