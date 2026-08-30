import type { CombatantLocation, DeathPort, TokenRef } from "../src/death-service";

/** A scripted actor the fake port answers questions about. */
export interface FakeActor {
  hp: number | null;
  uuid: string;
  name: string;
  explicitMob: boolean;
  boss: boolean;
  tokens: TokenRef[];
}

/**
 * In-memory {@link DeathPort} for unit tests: scripted actor/combat state plus
 * recorded side effects to assert against.
 */
export class FakeDeathPort implements DeathPort {
  public nowValue = 0;
  public announce = true;
  public windowMs = 45000;
  public combatByToken = new Map<string, CombatantLocation>();
  public existingCombats = new Set<string>();
  public combatTokens = new Set<string>();
  public tokensByUuid = new Map<string, TokenRef>();

  public hidden: string[] = [];
  public removed: CombatantLocation[] = [];
  public whispers: { token: TokenRef; combatId: string }[] = [];
  public posted: string[] = [];
  public unhidden: string[] = [];
  public added: { combatId: string; tokenId: string }[] = [];
  public warnedNoCombat = 0;

  public now(): number {
    return this.nowValue;
  }
  public actorHp(actor: unknown): number | null {
    return (actor as FakeActor).hp;
  }
  public actorUuid(actor: unknown): string {
    return (actor as FakeActor).uuid;
  }
  public actorName(actor: unknown): string {
    return (actor as FakeActor).name;
  }
  public isExplicitMob(actor: unknown): boolean {
    return (actor as FakeActor).explicitMob;
  }
  public isBoss(actor: unknown): boolean {
    return (actor as FakeActor).boss;
  }
  public tokensForActor(actor: unknown): TokenRef[] {
    return (actor as FakeActor).tokens;
  }
  public findCombatantForToken(tokenId: string): CombatantLocation | null {
    return this.combatByToken.get(tokenId) ?? null;
  }
  public async hideToken(token: TokenRef): Promise<void> {
    this.hidden.push(token.id);
  }
  public async removeCombatant(location: CombatantLocation): Promise<void> {
    this.removed.push(location);
  }
  public async whisperRestore(token: TokenRef, combatId: string): Promise<void> {
    this.whispers.push({ token, combatId });
  }
  public announceBossDeath(): boolean {
    return this.announce;
  }
  public killWindowMs(): number {
    return this.windowMs;
  }
  public async postPublic(content: string): Promise<void> {
    this.posted.push(content);
  }
  public localize(key: string, data: Record<string, string>): string {
    return `${key}|${JSON.stringify(data)}`;
  }
  public resolveToken(tokenUuid: string): TokenRef | null {
    return this.tokensByUuid.get(tokenUuid) ?? null;
  }
  public async unhideToken(token: TokenRef): Promise<void> {
    this.unhidden.push(token.id);
  }
  public combatExists(combatId: string): boolean {
    return this.existingCombats.has(combatId);
  }
  public combatHasToken(combatId: string, token: TokenRef): boolean {
    return this.combatTokens.has(`${combatId}:${token.id}`);
  }
  public async addTokenToCombat(combatId: string, token: TokenRef): Promise<void> {
    this.added.push({ combatId, tokenId: token.id });
  }
  public warnRestoreNoCombat(): void {
    this.warnedNoCombat += 1;
  }
}
