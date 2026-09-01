/**
 * @file Hook wiring. Registers the Foundry hooks that drive the module and routes
 * them to the orchestration service and boss lifecycle. All world-mutating logic
 * runs only on the active GM, and every async hook body is wrapped so a rejection
 * cannot become a silent failure (Foundry does not await hook handlers).
 */

import { FLAGS, MODULE_ID } from "../constants";
import { TacticalInitiative } from "../service";
import { getPlayerTimeoutMs } from "../settings";
import {
  cleanupBossPairOnDelete,
  setupBossCombatant,
  syncBossDefeat
} from "./boss-slots";
import { FoundryAdapter } from "./foundry-adapter";
import { readCombatantTag } from "./tags";

/**
 * Whether this client is the single active GM responsible for world mutations.
 *
 * @returns `true` on exactly one connected GM client.
 */
export function isActiveGM(): boolean {
  return game.user?.isGM === true && game.users?.activeGM === game.user;
}

/**
 * Run an async hook body, logging any rejection instead of letting it vanish.
 *
 * @param label - A short label for diagnostics.
 * @param body - The async work to run.
 */
export function guard(label: string, body: () => Promise<void>): void {
  body().catch((error: unknown) => {
    console.error(`${MODULE_ID} | ${label}`, error);
  });
}

/**
 * Build a service bound to a combat with the configured timeout.
 *
 * @param combat - The combat to operate on.
 * @returns A ready {@link TacticalInitiative}.
 */
function serviceFor(combat: FoundryCombat): TacticalInitiative {
  return new TacticalInitiative(new FoundryAdapter(combat, getPlayerTimeoutMs()));
}

/**
 * The last round number this client rolled for, per combat id. Guards against
 * `combatStart` and `combatRound` both firing for the same round (a version-
 * dependent double-fire) so players are prompted and rolled exactly once.
 */
const lastRolledRound = new Map<string, number>();

/**
 * Roll a whole combat for the current round at most once. Skips pre-start round 0
 * and any repeat call for a round already rolled, then resets the turn pointer to
 * the top of the freshly sorted order.
 *
 * @param combat - The combat to (maybe) roll.
 */
async function rollRoundOnce(combat: FoundryCombat): Promise<void> {
  if (combat.round < 1) return;
  if (lastRolledRound.get(combat.id) === combat.round) return;
  lastRolledRound.set(combat.id, combat.round);
  await serviceFor(combat).rollForCombat(combat.id);
  // After clear+reroll the sort order changed; point the tracker at the new top.
  await combat.update({ turn: 0 });
}

/**
 * Remove every module-created temporary effect from all actors in a combat.
 *
 * @param combat - The combat whose actors should be cleaned.
 */
async function removeAllTempEffects(combat: FoundryCombat): Promise<void> {
  const seen = new Set<string>();
  for (const combatant of combat.combatants.contents) {
    const actor = combatant.actor;
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    const ids = actor.effects
      .filter((effect) => effect.getFlag(MODULE_ID, FLAGS.TEMP_EFFECT) === true)
      .map((effect) => effect.id);
    if (ids.length > 0) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

/**
 * Register all runtime hooks. Call once from the `init` hook.
 */
export function registerHooks(): void {
  Hooks.on("combatStart", (combat: FoundryCombat): void => {
    if (!isActiveGM()) return;
    guard("combatStart", () => rollRoundOnce(combat));
  });

  Hooks.on("combatRound", (combat: FoundryCombat): void => {
    if (!isActiveGM()) return;
    guard("combatRound", () => rollRoundOnce(combat));
  });

  Hooks.on("createCombatant", (combatant: FoundryCombatant): void => {
    if (!isActiveGM()) return;
    const combat = combatant.combat;
    if (!combat) return;
    guard("createCombatant", async () => {
      const tag = readCombatantTag(combatant);
      const grouped = typeof combatant.group === "string" && combatant.group.length > 0;
      // A grouped combatant shares its group's initiative and gets no boss slots.
      if (tag === "boss" && !grouped) await setupBossCombatant(combatant, combat);
      // Mid-round join: grouped combatants and non-boss tags roll immediately;
      // an ungrouped boss is handled by its slot setup instead.
      if (combat.started && (grouped || tag !== "boss")) {
        await serviceFor(combat).rollForCombatant(combat.id, combatant.id);
      }
    });
  });

  Hooks.on("updateCombatant", (combatant: FoundryCombatant, changes: object): void => {
    if (!isActiveGM()) return;
    if (!("defeated" in changes)) return;
    const combat = combatant.combat;
    if (!combat) return;
    guard("updateCombatant", () => syncBossDefeat(combatant, combat));
  });

  Hooks.on("deleteCombatant", (combatant: FoundryCombatant): void => {
    if (!isActiveGM()) return;
    const combat = combatant.combat;
    if (!combat) return;
    guard("deleteCombatant", () => cleanupBossPairOnDelete(combatant, combat));
  });

  Hooks.on("deleteCombat", (combat: FoundryCombat): void => {
    lastRolledRound.delete(combat.id);
    if (!isActiveGM()) return;
    guard("deleteCombat", () => removeAllTempEffects(combat));
  });

  registerChoosingIndicator();
}

/**
 * Best-effort: mark combat-tracker rows whose player is still choosing. Wrapped
 * so a tracker-DOM change in a future Foundry version cannot break rendering.
 */
function registerChoosingIndicator(): void {
  Hooks.on("renderCombatTracker", (app: unknown, html: unknown): void => {
    try {
      const root = html instanceof HTMLElement ? html : (html as { 0?: unknown } | null)?.[0];
      if (!(root instanceof HTMLElement)) return;
      const combat = (app as { viewed?: FoundryCombat | null }).viewed ?? null;
      if (!combat) return;
      for (const combatant of combat.combatants.contents) {
        if (combatant.getFlag(MODULE_ID, FLAGS.CHOOSING) !== true) continue;
        const row = root.querySelector<HTMLElement>(`[data-combatant-id="${combatant.id}"]`);
        if (row) row.classList.add(`${MODULE_ID}-choosing`);
      }
    } catch {
      // Non-critical indicator.
    }
  });
}
