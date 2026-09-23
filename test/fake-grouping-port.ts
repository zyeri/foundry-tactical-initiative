import type { GroupRef } from "../src/logic/group";
import type {
  GroupingCombatantRef,
  GroupingPort,
  GroupPromptRequest,
  GroupPromptResult
} from "../src/grouping-service";

/** Stateful in-memory GroupingPort; records every write in `calls`. */
export class FakeGroupingPort implements GroupingPort {
  public combatId: string | null = "combat";
  public started = false;
  public combatants: GroupingCombatantRef[] = [];
  public groups: GroupRef[] = [];
  public names = new Map<string, string>();
  public promptResult: GroupPromptResult = null;
  public prompts: GroupPromptRequest[] = [];
  public rollValue: number | null = 15;
  public calls: string[] = [];
  public warnings: string[] = [];
  private nextId = 1;

  public async resolveCombat(): Promise<string | null> {
    this.calls.push("resolveCombat");
    return this.combatId;
  }
  public listCombatants(): GroupingCombatantRef[] {
    return this.combatants.map((c) => ({ ...c }));
  }
  public listGroups(): GroupRef[] {
    return this.groups.map((g) => ({ ...g }));
  }
  public isStarted(): boolean {
    return this.started;
  }
  public tokenActorNames(tokenIds: readonly string[]): string[] {
    return tokenIds.map((id) => this.names.get(id) ?? "");
  }
  public fallbackGroupName(): string {
    return "Group";
  }
  public async createGroup(_combatId: string, name: string): Promise<string> {
    const id = `g${this.nextId++}`;
    this.groups.push({ id, name, color: null });
    this.calls.push(`createGroup:${name}`);
    return id;
  }
  public async createCombatants(
    _combatId: string,
    tokenIds: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<string[]> {
    const ids = tokenIds.map((tokenId) => {
      const id = `c${this.nextId++}`;
      this.combatants.push({ id, tokenId, groupId, initiative, bossEndSlot: false });
      return id;
    });
    this.calls.push(`createCombatants:${tokenIds.join(",")}:${groupId}:${initiative}`);
    return ids;
  }
  public async assign(
    _combatId: string,
    ids: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<void> {
    for (const c of this.combatants) {
      if (!ids.includes(c.id)) continue;
      c.groupId = groupId;
      if (initiative !== null) c.initiative = initiative;
    }
    this.calls.push(`assign:${ids.join(",")}:${groupId}:${initiative}`);
  }
  public async unassign(_combatId: string, ids: readonly string[]): Promise<void> {
    for (const c of this.combatants) if (ids.includes(c.id)) c.groupId = null;
    this.calls.push(`unassign:${ids.join(",")}`);
  }
  public async deleteGroup(_combatId: string, groupId: string): Promise<void> {
    this.groups = this.groups.filter((g) => g.id !== groupId);
    this.calls.push(`deleteGroup:${groupId}`);
  }
  public async rollGroupInitiative(_combatId: string, groupId: string): Promise<number | null> {
    this.calls.push(`roll:${groupId}`);
    return this.rollValue;
  }
  public async setInitiative(_combatId: string, ids: readonly string[], value: number): Promise<void> {
    for (const c of this.combatants) if (ids.includes(c.id)) c.initiative = value;
    this.calls.push(`setInitiative:${[...ids].sort().join(",")}:${value}`);
  }
  public async tearDownBoss(_combatId: string, ids: readonly string[]): Promise<void> {
    this.calls.push(`tearDownBoss:${ids.join(",")}`);
  }
  public async reconcileBoss(_combatId: string, ids: readonly string[]): Promise<void> {
    this.calls.push(`reconcileBoss:${ids.join(",")}`);
  }
  public async prompt(request: GroupPromptRequest): Promise<GroupPromptResult> {
    this.prompts.push(request);
    return this.promptResult;
  }
  public warn(key: string): void {
    this.warnings.push(key);
  }
}
