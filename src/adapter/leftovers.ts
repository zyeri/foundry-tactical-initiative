/**
 * @file Safety net for token deletion: core Foundry removes a deleted token's
 * combatants; this catches any it left behind. The active GM collects deleted
 * tokens, waits for core's own deletes to land, then asks once (Remove / Keep)
 * for every combatant whose token is gone. Foundry boundary: the detection is
 * tested in test/leftovers.test.ts; this wiring is on the README checklist.
 */

import { findLeftovers, type DeletedTokenRef, type LeftoverCandidate } from "../logic/leftovers";
import { guard, isActiveGM } from "./hooks";

/**
 * Delay before checking, ms. Long enough for core's own combatant deletes
 * (issued by whichever client deleted the token) to reach the active GM, so a
 * normal delete never prompts; also batches multi-token deletes.
 */
const FLUSH_DELAY_MS = 1000;

/** Deleted tokens waiting for the next flush. */
let queue: DeletedTokenRef[] = [];

/** Pending flush timer, if any. */
let timer: ReturnType<typeof setTimeout> | null = null;

/** Escape text for DialogV2 HTML content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Whether a token still exists on its scene (unknown scene counts as gone). */
function tokenExists(sceneId: string, tokenId: string): boolean {
  return game.scenes?.get(sceneId)?.tokens.has(tokenId) === true;
}

/** Every combatant of every combat, as leftover candidates. */
function candidates(): LeftoverCandidate[] {
  return (game.combats?.contents ?? []).flatMap((combat) =>
    combat.turns.map((c) => ({
      combatId: combat.id,
      combatantId: c.id,
      name: c.name,
      sceneId: c.sceneId,
      tokenId: c.tokenId
    }))
  );
}

/** Check the queued deletions and, if any combatant was left behind, ask. */
async function flush(): Promise<void> {
  const deleted = queue;
  queue = [];
  timer = null;
  const leftovers = findLeftovers(candidates(), deleted, tokenExists);
  if (leftovers.length === 0) return;
  const names = leftovers.map((l) => `<li>${escapeHtml(l.name)}</li>`).join("");
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("TACTICAL_INITIATIVE.Leftover.Title") },
    content: `<p>${escapeHtml(game.i18n.localize("TACTICAL_INITIATIVE.Leftover.Body"))}</p><ul>${names}</ul>`,
    buttons: [
      { action: "remove", label: game.i18n.localize("TACTICAL_INITIATIVE.Leftover.Remove"), default: true },
      { action: "keep", label: game.i18n.localize("TACTICAL_INITIATIVE.Leftover.Keep") }
    ],
    rejectClose: false,
    modal: true
  });
  if (choice !== "remove") return;
  const byCombat = new Map<string, string[]>();
  for (const leftover of leftovers) {
    const combat = game.combats?.get(leftover.combatId);
    // Re-fetch: another GM, core, or a boss-pair cascade may have removed it meanwhile.
    if (!combat?.combatants.get(leftover.combatantId)) continue;
    byCombat.set(leftover.combatId, [...(byCombat.get(leftover.combatId) ?? []), leftover.combatantId]);
  }
  for (const [combatId, ids] of byCombat) {
    const combat = game.combats?.get(combatId);
    const still = ids.filter((id) => combat?.combatants.get(id));
    if (combat && still.length > 0) await combat.deleteEmbeddedDocuments("Combatant", still);
  }
}

/**
 * Register the deleteToken safety net (call at `init`). Runs on the active GM
 * only, whoever deleted the token. Emptied groups are swept by the existing
 * deleteCombatant hook.
 */
export function registerLeftoverSweep(): void {
  Hooks.on("deleteToken", (token: FoundryTokenDocument): void => {
    if (!isActiveGM()) return;
    const sceneId = token.parent?.id ?? null;
    if (sceneId === null) return;
    queue.push({ sceneId, tokenId: token.id });
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      guard("leftover sweep", flush);
    }, FLUSH_DELAY_MS);
  });
}
