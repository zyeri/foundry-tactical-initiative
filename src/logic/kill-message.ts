/**
 * @file Pure selector mapping a boss death + optional attribution to an i18n key
 * and interpolation data. The adapter localizes. No Foundry globals.
 */

import type { Attribution } from "./kill-source";

/** An i18n key plus its interpolation data. */
export interface KillMessage {
  /** The localization key. */
  key: string;
  /** Interpolation values (`killer`, `boss`, `weapon`). */
  data: Record<string, string>;
}

/**
 * Choose the boss-death chat message for a given attribution.
 *
 * @param bossName - Display name of the boss that fell.
 * @param attribution - The resolved credit, or `null` for the plain fallback.
 * @returns The i18n key and interpolation data.
 */
export function killMessageKey(bossName: string, attribution: Attribution | null): KillMessage {
  if (!attribution) {
    return { key: "TACTICAL_INITIATIVE.Chat.BossDied", data: { boss: bossName } };
  }
  if (attribution.itemName === null) {
    return {
      key: "TACTICAL_INITIATIVE.Chat.BossKilledNoWeapon",
      data: { killer: attribution.attackerName, boss: bossName }
    };
  }
  return {
    key: "TACTICAL_INITIATIVE.Chat.BossKilled",
    data: { killer: attribution.attackerName, boss: bossName, weapon: attribution.itemName }
  };
}
