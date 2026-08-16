/**
 * @file The player-choice dialog and the v13 socketless query that shows it on
 * the owning player's client. The GM calls {@link requestChoiceFromOwner}; the
 * handler registered by {@link registerQueryHandler} runs on the player's client.
 */

import { CHOICES, QUERY_CHOOSE, type Choice } from "../constants";

/**
 * The payload sent to the owning player's client with the choice query.
 */
interface ChoiceQueryData {
  /** The combatant actor's display name, shown in the dialog. */
  actorName: string;
}

/**
 * Coerce an arbitrary query result into a valid {@link Choice}, or `null` when it
 * is not a recognized choice (dialog closed, timed out, or malformed).
 *
 * @param value - The raw query result.
 * @returns The choice, or `null` for "no usable answer".
 */
function toChoiceOrNull(value: unknown): Choice | null {
  return typeof value === "string" && (CHOICES as readonly string[]).includes(value)
    ? (value as Choice)
    : null;
}

/**
 * Type guard for the choice query payload.
 *
 * @param data - The received query data.
 * @returns Whether it carries a string `actorName`.
 */
function isChoiceQueryData(data: object): data is ChoiceQueryData {
  return typeof (data as { actorName?: unknown }).actorName === "string";
}

/**
 * Show the three-button initiative dialog on this client and resolve to the
 * chosen {@link Choice}, or `null` if the dialog is dismissed. Runs on the
 * owning player's client via the registered query handler.
 *
 * @param data - The query payload (the actor's name).
 * @returns The player's choice, or `null` when dismissed.
 */
async function showChoiceDialog(data: object): Promise<Choice | null> {
  const actorName = isChoiceQueryData(data) ? data.actorName : "";
  const localize = (key: string): string => game.i18n.localize(key);
  const prompt = game.i18n.format("TACTICAL_INITIATIVE.Dialog.Prompt", { name: actorName });
  const content = [
    `<p>${prompt}</p>`,
    `<ul class="tactical-initiative-choices">`,
    `<li><strong>${localize("TACTICAL_INITIATIVE.Choice.Rush.Label")}</strong> - ${localize("TACTICAL_INITIATIVE.Choice.Rush.Hint")}</li>`,
    `<li><strong>${localize("TACTICAL_INITIATIVE.Choice.March.Label")}</strong> - ${localize("TACTICAL_INITIATIVE.Choice.March.Hint")}</li>`,
    `<li><strong>${localize("TACTICAL_INITIATIVE.Choice.Hunker.Label")}</strong> - ${localize("TACTICAL_INITIATIVE.Choice.Hunker.Hint")}</li>`,
    `</ul>`
  ].join("");

  const action = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("TACTICAL_INITIATIVE.Dialog.Title") },
    content,
    modal: false,
    rejectClose: false,
    buttons: [
      { action: "rush", label: localize("TACTICAL_INITIATIVE.Choice.Rush.Label") },
      { action: "march", label: localize("TACTICAL_INITIATIVE.Choice.March.Label"), default: true },
      { action: "hunker", label: localize("TACTICAL_INITIATIVE.Choice.Hunker.Label") }
    ]
  });
  return toChoiceOrNull(action);
}

/**
 * Register the choice-dialog query handler in `CONFIG.queries`. Must run on every
 * client during `init`, so any client can be asked to show the dialog.
 */
export function registerQueryHandler(): void {
  CONFIG.queries[QUERY_CHOOSE] = async (queryData: object): Promise<unknown> => {
    return showChoiceDialog(queryData);
  };
}

/**
 * Pick the active, non-GM owning user to prompt for a combatant, or `null`.
 *
 * @param combatant - The combatant whose owner should choose.
 * @returns The first active player owner, or `null` if none is connected.
 */
export function pickOwningUser(combatant: FoundryCombatant): FoundryUser | null {
  const owners = combatant.players.filter((user) => !user.isGM && user.active);
  return owners[0] ?? null;
}

/**
 * Ask the owning player for their initiative choice via the v13 query mechanism.
 * Robust to both possible timeout/offline behaviors (rejection or an undefined
 * resolution): returns `null` for any no-answer outcome so the caller can default
 * to March.
 *
 * @param combatant - The player's combatant.
 * @param timeoutMs - Milliseconds to wait before giving up.
 * @returns The chosen {@link Choice}, or `null` when offline / timed out / dismissed.
 */
export async function requestChoiceFromOwner(
  combatant: FoundryCombatant,
  timeoutMs: number
): Promise<Choice | null> {
  const user = pickOwningUser(combatant);
  if (!user || !user.active) return null;
  const data: ChoiceQueryData = { actorName: combatant.actor?.name ?? "" };
  try {
    const result = await user.query(QUERY_CHOOSE, data, { timeout: timeoutMs });
    return toChoiceOrNull(result);
  } catch {
    return null;
  }
}
