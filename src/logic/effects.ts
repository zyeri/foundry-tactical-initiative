/**
 * @file Pure logic that builds Active Effect change data for a choice. No Foundry
 * globals, no side effects - it returns plain data the adapter turns into an effect.
 */

import {
  ACTIVE_EFFECT_MODE_ADD,
  ACTIVE_EFFECT_TYPE_ADD,
  CHOICE_EFFECT_MODIFIER,
  DND5E_BONUS_KEYS,
  type Choice
} from "../constants";
import type { EffectChange, EffectChangeV14 } from "../types";

/**
 * Format a signed integer as a dnd5e bonus formula string, e.g. `-1` or `+2`.
 *
 * @param modifier - The signed modifier.
 * @returns The modifier with an explicit leading sign.
 */
function formatBonus(modifier: number): string {
  return modifier < 0 ? String(modifier) : `+${modifier}`;
}

/**
 * Build the Active Effect changes for a player's initiative choice.
 *
 * Rush imposes `-1` and Hunker Down grants `+2` to attack rolls, saving throws,
 * and ability checks, applied as ADD-mode changes across {@link DND5E_BONUS_KEYS}.
 * March produces no effect (an empty array).
 *
 * @param choice - The player's initiative choice.
 * @returns One {@link EffectChange} per dnd5e bonus key, or `[]` for march.
 */
export function effectChangesFor(choice: Choice): EffectChange[] {
  const modifier = CHOICE_EFFECT_MODIFIER[choice];
  if (modifier === 0) return [];
  const value = formatBonus(modifier);
  return DND5E_BONUS_KEYS.map((key) => ({
    key,
    mode: ACTIVE_EFFECT_MODE_ADD,
    value,
    priority: 20
  }));
}

/**
 * Convert legacy {@link EffectChange} entries (numeric `mode`) to the Foundry
 * v14+ {@link EffectChangeV14} shape (string `type`). This module only ever
 * emits ADD-mode changes, so `mode` maps directly to `"add"`.
 *
 * @param changes - Legacy change entries from {@link effectChangesFor}.
 * @returns The same changes with `mode` replaced by `type: "add"`.
 */
export function toV14Changes(changes: EffectChange[]): EffectChangeV14[] {
  return changes.map(({ key, value, priority }) => ({
    key,
    type: ACTIVE_EFFECT_TYPE_ADD,
    value,
    priority
  }));
}
