/**
 * @file Module settings registration and typed accessors.
 */

import { DEFAULT_KILL_WINDOW_SECONDS, MODULE_ID, SETTINGS } from "./constants";

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
  game.settings.register(MODULE_ID, SETTINGS.ANNOUNCE_BOSS_DEATH, {
    name: "TACTICAL_INITIATIVE.Settings.AnnounceBossDeath.Name",
    hint: "TACTICAL_INITIATIVE.Settings.AnnounceBossDeath.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.KILL_WINDOW, {
    name: "TACTICAL_INITIATIVE.Settings.KillAttributionWindow.Name",
    hint: "TACTICAL_INITIATIVE.Settings.KillAttributionWindow.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_KILL_WINDOW_SECONDS,
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

/**
 * Whether a boss death should post a public chat callout.
 *
 * @returns The `announceBossDeath` world setting (defaults to `true`).
 */
export function getAnnounceBossDeath(): boolean {
  const raw = game.settings.get(MODULE_ID, SETTINGS.ANNOUNCE_BOSS_DEATH);
  return raw !== false;
}

/**
 * The kill-attribution staleness window, in milliseconds (minimum 5s).
 *
 * @returns The window in milliseconds.
 */
export function getKillWindowMs(): number {
  const raw = game.settings.get(MODULE_ID, SETTINGS.KILL_WINDOW);
  const seconds =
    typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_KILL_WINDOW_SECONDS;
  return Math.max(5, seconds) * 1000;
}
