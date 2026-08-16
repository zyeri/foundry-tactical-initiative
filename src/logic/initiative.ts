/**
 * @file Pure initiative-choice logic. No Foundry globals, no side effects.
 */

import { CHOICE_INIT_ADJUST, CHOICES, type Choice } from "../constants";

/**
 * The flat adjustment added to a player's normal initiative roll for their choice.
 *
 * @param choice - The player's initiative choice.
 * @returns `+3` for rush, `0` for march, `-6` for hunker.
 */
export function initiativeAdjustment(choice: Choice): number {
  return CHOICE_INIT_ADJUST[choice];
}

/**
 * Coerce an untrusted value (e.g. a dialog result, a timed-out query) into a
 * valid {@link Choice}, defaulting to `"march"` for anything invalid or missing.
 *
 * @param raw - Any value that should represent a choice.
 * @returns The value itself when it is a valid choice, otherwise `"march"`.
 */
export function normalizeChoice(raw: unknown): Choice {
  return typeof raw === "string" && (CHOICES as readonly string[]).includes(raw)
    ? (raw as Choice)
    : "march";
}
