/**
 * @file Shared domain types: the data shape of an Active Effect change, the
 * Foundry-agnostic view of a combatant, and the `FoundryPort` interface that
 * decouples the orchestration service from the real Foundry runtime.
 */

import type { BossSlot, Choice, Tag } from "./constants";

/**
 * A single Active Effect change entry, mirroring Foundry's `EffectChangeData`
 * for the subset of fields this module sets.
 */
export interface EffectChange {
  /** The document path the change targets, e.g. `"system.bonuses.abilities.check"`. */
  key: string;
  /** The Active Effect application mode; this module always uses ADD (`2`). */
  mode: number;
  /** The change value as a formula string, e.g. `"-1"` or `"+2"`. */
  value: string;
  /** The application priority; higher applies later. */
  priority: number;
}

/**
 * A single Active Effect change entry in the Foundry v14+ schema, where numeric
 * `mode` was replaced by a string `type` and the `changes` array lives under
 * `system.changes`. Otherwise identical to {@link EffectChange}.
 */
export interface EffectChangeV14 {
  /** The document path the change targets. */
  key: string;
  /** The v14 change type; this module always uses `"add"`. */
  type: string;
  /** The change value as a formula string, e.g. `"-1"` or `"+2"`. */
  value: string;
  /** The application priority; higher applies later. */
  priority: number;
}

/**
 * A Foundry-agnostic snapshot of a combatant, carrying only what the
 * orchestration service needs to decide initiative behavior.
 */
export interface CombatantView {
  /** The combatant document id. */
  id: string;
  /** The id of the combatant's actor. */
  actorId: string;
  /** A display name used in chat notes. */
  actorName: string;
  /** The resolved tactical tag. */
  tag: Tag;
  /** Whether the combatant is marked defeated. */
  isDefeated: boolean;
  /** For boss combatants: which slot this entry is; otherwise `null`. */
  bossSlot: BossSlot | null;
  /** For boss combatants: the stable ordering rank; otherwise `null`. */
  bossRank: number | null;
}

/**
 * The seam between the orchestration service and Foundry. The real adapter
 * (`src/adapter/foundry-adapter.ts`) implements this against live Foundry/dnd5e
 * APIs; tests implement an in-memory fake. Every method is side-effecting and
 * asynchronous.
 */
export interface FoundryPort {
  /**
   * List the combatants of a combat as Foundry-agnostic views.
   * @param combatId - The combat document id.
   */
  listCombatants(combatId: string): Promise<CombatantView[]>;

  /**
   * Clear a combatant's initiative (set it to unrolled/null).
   * @param combatantId - The combatant document id.
   */
  clearInitiative(combatantId: string): Promise<void>;

  /**
   * Remove all module-created temporary effects from an actor.
   * @param actorId - The actor id.
   */
  removeTempEffects(actorId: string): Promise<void>;

  /**
   * Apply the temporary Active Effect for a choice to an actor. A `march`
   * choice is a no-op.
   * @param actorId - The actor id.
   * @param choice - The player's initiative choice.
   */
  applyEffect(actorId: string, choice: Choice): Promise<void>;

  /**
   * Roll the combatant's normal dnd5e initiative and return the total without
   * persisting it. The service persists the final value via {@link setInitiative}.
   * @param combatantId - The combatant document id.
   */
  rollInitiativeValue(combatantId: string): Promise<number>;

  /**
   * Persist a combatant's initiative value.
   * @param combatantId - The combatant document id.
   * @param value - The initiative value to store.
   */
  setInitiative(combatantId: string, value: number): Promise<void>;

  /**
   * Ask the owning player for their initiative choice.
   * @param combatantId - The combatant document id.
   * @returns The chosen {@link Choice}, or `null` when the owner is offline or
   *   does not answer before the timeout.
   */
  requestPlayerChoice(combatantId: string): Promise<Choice | null>;

  /**
   * Toggle the "currently choosing" indicator shown in the combat tracker.
   * @param combatantId - The combatant document id.
   * @param choosing - Whether the player's dialog is open.
   */
  markChoosing(combatantId: string, choosing: boolean): Promise<void>;

  /**
   * Post a chat note that a player defaulted to March (offline or timed out).
   * @param actorName - The player actor's display name.
   */
  announceDefaultMarch(actorName: string): Promise<void>;
}
