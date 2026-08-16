/**
 * @file Module settings registration and typed accessors.
 */

import { MODULE_ID, SETTINGS } from "./constants";

/**
 * Register all module settings. Call once from the `init` hook.
 */
export function registerSettings(): void {
  game.settings.register(MODULE_ID, SETTINGS.PLAYER_TIMEOUT, {
    name: "TACTICAL_INITIATIVE.Settings.PlayerTimeout.Name",
    hint: "TACTICAL_INITIATIVE.Settings.PlayerTimeout.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 30,
    range: { min: 5, max: 300, step: 5 }
  });
}

/**
 * The configured player-choice timeout, in milliseconds (minimum 5s).
 *
 * @returns The timeout in milliseconds.
 */
export function getPlayerTimeoutMs(): number {
  const raw = game.settings.get(MODULE_ID, SETTINGS.PLAYER_TIMEOUT);
  const seconds = typeof raw === "number" && Number.isFinite(raw) ? raw : 30;
  return Math.max(5, seconds) * 1000;
}
