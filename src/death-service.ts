/**
 * @file The death/attribution orchestration service. It holds the F4 (mob
 * remove+hide) and F5 (boss chat callout) decision flow and depends only on the
 * {@link DeathPort} seam, so it is fully unit-tested against an in-memory fake
 * (`test/fake-death-port.ts`). The real Foundry binding lives in the adapter.
 */

import { crossedToZero } from "./logic/death";
import { hpTransition, type HpChanges } from "./logic/hp";
import { killMessageKey } from "./logic/kill-message";
import { nextSource, selectAttribution, type DamageEvent, type Source } from "./logic/kill-source";

/** Where a combatant lives: its combat and its own id. */
export interface CombatantLocation {
  /** The combat document id. */
  combatId: string;
  /** The combatant document id. */
  combatantId: string;
}

/** A minimal reference to a scene token. */
export interface TokenRef {
  /** The token document id. */
  id: string;
  /** The token document UUID. */
  uuid: string;
  /** The token's display name. */
  name: string;
}

/**
 * The seam between {@link DeathService} and Foundry. The real adapter implements
 * this against live documents; tests implement an in-memory fake. Query methods
 * take an opaque actor handle the port itself understands.
 */
export interface DeathPort {
  /** Current time in epoch milliseconds. */
  now(): number;
  /** The actor's current hit points, or `null` when unavailable. */
  actorHp(actor: unknown): number | null;
  /** The actor's UUID. */
  actorUuid(actor: unknown): string;
  /** The actor's display name. */
  actorName(actor: unknown): string;
  /** Whether the actor's stored tag is explicitly `mob`. */
  isExplicitMob(actor: unknown): boolean;
  /** Whether the actor's resolved tag is `boss`. */
  isBoss(actor: unknown): boolean;
  /** The token(s) that represent the dead actor (the exact token for an unlinked one). */
  tokensForActor(actor: unknown): TokenRef[];
  /** Locate a token's combatant across all combats, or `null` when it is in none. */
  findCombatantForToken(tokenId: string): CombatantLocation | null;
  /** Hide a token from players. */
  hideToken(tokenId: string): Promise<void>;
  /** Remove a combatant from its combat. */
  removeCombatant(location: CombatantLocation): Promise<void>;
  /** Whisper the GM a one-click restore link for a removed mob. */
  whisperRestore(token: TokenRef, combatId: string): Promise<void>;
  /** Whether boss-death callouts are enabled. */
  announceBossDeath(): boolean;
  /** The kill-attribution staleness window in milliseconds. */
  killWindowMs(): number;
  /** Post a public chat message. */
  postPublic(content: string): Promise<void>;
  /** Localize an i18n key with interpolation data. */
  localize(key: string, data: Record<string, string>): string;
  /** Resolve a token UUID to a reference, or `null` when it no longer exists. */
  resolveToken(tokenUuid: string): TokenRef | null;
  /** Un-hide a token. */
  unhideToken(tokenId: string): Promise<void>;
  /** Whether a combat still exists. */
  combatExists(combatId: string): boolean;
  /** Whether a combat already has a combatant for a token. */
  combatHasToken(combatId: string, tokenId: string): boolean;
  /** Add a token to a combat as a new combatant. */
  addTokenToCombat(combatId: string, tokenId: string): Promise<void>;
  /** Notify the GM that a restore target combat no longer exists. */
  warnRestoreNoCombat(): void;
}

/**
 * Orchestrates the F4/F5 automations. Construct one per GM client with a real
 * {@link DeathPort}.
 */
export class DeathService {
  /** The last real damage source seen this session. */
  private lastSource: Source | null = null;

  /**
   * @param port - The Foundry seam.
   */
  public constructor(private readonly port: DeathPort) {}

  /**
   * Fold a parsed damage event into the recorded source (a `null` event is a no-op).
   *
   * @param event - The parsed damage event, or `null`.
   */
  public recordDamage(event: DamageEvent | null): void {
    if (event === null) return;
    this.lastSource = nextSource(this.lastSource, event);
  }

  /** The current recorded damage source (for later consumers). */
  public getLastSource(): Source | null {
    return this.lastSource;
  }

  /**
   * React to an actor's HP change: if it just crossed to 0, run the mob and boss
   * rules that apply.
   *
   * @param actor - The damaged actor handle.
   * @param changes - The signed-delta payload from `dnd5e.damageActor`.
   */
  public async handleDamage(actor: unknown, changes: HpChanges): Promise<void> {
    const resultingHp = this.port.actorHp(actor);
    if (resultingHp === null) return;
    if (resultingHp > 0) return;
    const { previousHp, newHp } = hpTransition(resultingHp, changes);
    if (!crossedToZero(previousHp, newHp)) return;
    if (this.port.isExplicitMob(actor)) await this.handleMob(actor);
    if (this.port.isBoss(actor)) await this.handleBoss(actor);
  }

  /**
   * Restore a removed mob to its origin combat and un-hide its token.
   *
   * @param tokenUuid - The removed token's UUID.
   * @param combatId - The combat the mob was removed from.
   */
  public async restoreMob(tokenUuid: string, combatId: string): Promise<void> {
    const token = this.port.resolveToken(tokenUuid);
    if (!token) return;
    await this.port.unhideToken(token.id);
    if (!this.port.combatExists(combatId)) {
      this.port.warnRestoreNoCombat();
      return;
    }
    if (!this.port.combatHasToken(combatId, token.id)) {
      await this.port.addTokenToCombat(combatId, token.id);
    }
  }

  /**
   * F4: remove an explicitly-tagged mob from combat and hide the token(s) that died.
   *
   * @param actor - The dead actor handle.
   */
  private async handleMob(actor: unknown): Promise<void> {
    for (const token of this.port.tokensForActor(actor)) {
      const location = this.port.findCombatantForToken(token.id);
      if (!location) continue;
      await this.port.hideToken(token.id);
      await this.port.removeCombatant(location);
      await this.port.whisperRestore(token, location.combatId);
    }
  }

  /**
   * F5: post a public, best-effort attributed boss-death callout.
   *
   * @param actor - The dead actor handle.
   */
  private async handleBoss(actor: unknown): Promise<void> {
    if (!this.port.announceBossDeath()) return;
    const attribution = selectAttribution(
      this.lastSource,
      this.port.actorUuid(actor),
      this.port.now(),
      this.port.killWindowMs()
    );
    const { key, data } = killMessageKey(this.port.actorName(actor), attribution);
    await this.port.postPublic(this.port.localize(key, data));
  }
}
