/**
 * @file In-memory {@link FoundryPort} implementation used by the service tests.
 * It records every call in order and lets each test script combatants, roll
 * values, and player choices (including `null` for offline/timeout).
 */

import type { Choice } from "../src/constants";
import type { CombatantView, FoundryPort } from "../src/types";

/**
 * A combatant fixture: a {@link CombatantView} plus the roll value the fake
 * returns and an optional scripted player choice.
 */
export interface FakeCombatant extends CombatantView {
  /** Value returned by {@link FakePort.rollInitiativeValue}. */
  rollValue: number;
  /** Scripted player choice; `null` simulates offline/timeout, omitted also means none. */
  choiceResult?: Choice | null;
}

/** A recorded port call, for order-sensitive assertions. */
export interface RecordedCall {
  /** The port method name. */
  method: string;
  /** The arguments passed, in order. */
  args: readonly unknown[];
}

/**
 * Records calls and simulates the Foundry side effects the service triggers.
 */
export class FakePort implements FoundryPort {
  /** Every method call in invocation order. */
  public readonly calls: RecordedCall[] = [];
  /** Latest persisted initiative per combatant id (`null` when cleared). */
  public readonly initiatives = new Map<string, number | null>();
  /** Applied non-march effect choice per actor id. */
  public readonly effects = new Map<string, Choice>();
  /** Actor ids that had temp effects removed, in order. */
  public readonly removedEffects: string[] = [];
  /** markChoosing toggles in order. */
  public readonly choosing: Array<{ id: string; choosing: boolean }> = [];
  /** Names announced as defaulting to March. */
  public readonly announced: string[] = [];

  /**
   * @param combatants - The fixtures this fake exposes via {@link listCombatants}.
   */
  public constructor(private readonly combatants: FakeCombatant[]) {}

  /** Index of the first call to `method`, or `-1`. */
  public firstIndexOf(method: string): number {
    return this.calls.findIndex((c) => c.method === method);
  }

  /** Index of the last call to `method`, or `-1`. */
  public lastIndexOf(method: string): number {
    return this.calls.map((c) => c.method).lastIndexOf(method);
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  private find(id: string): FakeCombatant {
    const found = this.combatants.find((c) => c.id === id);
    if (!found) throw new Error(`FakePort: no combatant with id ${id}`);
    return found;
  }

  public async listCombatants(combatId: string): Promise<CombatantView[]> {
    this.record("listCombatants", combatId);
    return this.combatants;
  }

  public async clearInitiative(combatantId: string): Promise<void> {
    this.record("clearInitiative", combatantId);
    this.initiatives.set(combatantId, null);
  }

  public async removeTempEffects(actorId: string): Promise<void> {
    this.record("removeTempEffects", actorId);
    this.removedEffects.push(actorId);
    this.effects.delete(actorId);
  }

  public async applyEffect(actorId: string, choice: Choice): Promise<void> {
    this.record("applyEffect", actorId, choice);
    // Mirror the real adapter: march creates no effect.
    if (choice !== "march") this.effects.set(actorId, choice);
  }

  public async rollInitiativeValue(combatantId: string): Promise<number> {
    this.record("rollInitiativeValue", combatantId);
    return this.find(combatantId).rollValue;
  }

  public async setInitiative(combatantId: string, value: number): Promise<void> {
    this.record("setInitiative", combatantId, value);
    this.initiatives.set(combatantId, value);
  }

  public async requestPlayerChoice(combatantId: string): Promise<Choice | null> {
    this.record("requestPlayerChoice", combatantId);
    return this.find(combatantId).choiceResult ?? null;
  }

  public async markChoosing(combatantId: string, choosing: boolean): Promise<void> {
    this.record("markChoosing", combatantId, choosing);
    this.choosing.push({ id: combatantId, choosing });
  }

  public async announceDefaultMarch(actorName: string): Promise<void> {
    this.record("announceDefaultMarch", actorName);
    this.announced.push(actorName);
  }
}

/**
 * Build a {@link FakeCombatant} fixture with sensible defaults.
 *
 * @param over - Partial fields to override; `id` and `tag` are required.
 * @returns A complete fixture.
 */
export function makeCombatant(
  over: Partial<FakeCombatant> & Pick<FakeCombatant, "id" | "tag">
): FakeCombatant {
  return {
    actorId: `${over.id}-actor`,
    actorName: `${over.id}-name`,
    isDefeated: false,
    bossSlot: null,
    bossRank: null,
    rollValue: 10,
    ...over
  };
}
