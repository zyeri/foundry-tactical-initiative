/**
 * @file Battlemap entry points for grouping: a Token HUD button and the `G`
 * keybinding (GM only), both running {@link GroupingService} over the real port.
 * Foundry boundary: not unit-tested; README checklist.
 */

import { KEYBINDINGS, MODULE_ID } from "../constants";
import { GroupingService } from "../grouping-service";
import { runSafe } from "../ui/run-safe";
import { FoundryGroupingPort } from "./grouping";

/**
 * Group the controlled tokens plus an optional extra token (the HUD's token).
 *
 * @param extraTokenId - A token to include even if it is not controlled.
 */
export async function groupSelectedTokens(extraTokenId?: string): Promise<void> {
  if (game.user?.isGM !== true) return;
  const ids = (canvas.tokens?.controlled ?? []).map((token) => token.id);
  if (extraTokenId) ids.push(extraTokenId);
  await new GroupingService(new FoundryGroupingPort()).groupSelected(ids);
}

/** Register the GM-only "Group selected tokens" keybinding (call at `init`). */
export function registerGroupingKeybinding(): void {
  game.keybindings.register(MODULE_ID, KEYBINDINGS.GROUP_SELECTED, {
    name: "TACTICAL_INITIATIVE.Grouping.KeyName",
    hint: "TACTICAL_INITIATIVE.Grouping.KeyHint",
    editable: [{ key: "KeyG" }],
    restricted: true,
    onDown: (): boolean => {
      void runSafe("group selected", () => groupSelectedTokens());
      return true;
    }
  });
}

/** Add the group button to the Token HUD's left column (GM only, once per render). */
export function registerTokenHudButton(): void {
  Hooks.on("renderTokenHUD", (app: unknown, html: unknown): void => {
    if (game.user?.isGM !== true) return;
    const root = html instanceof HTMLElement ? html : (html as { 0?: unknown } | null)?.[0];
    if (!(root instanceof HTMLElement)) return;
    const column = root.querySelector<HTMLElement>(".col.left");
    if (!column || column.querySelector(`.${MODULE_ID}-group-btn`)) return;
    const tokenId = (app as { object?: { id?: string } }).object?.id;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `control-icon ${MODULE_ID}-group-btn`;
    button.title = game.i18n.localize("TACTICAL_INITIATIVE.Grouping.HudButton");
    const icon = document.createElement("i");
    icon.className = "fas fa-object-group";
    button.appendChild(icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void runSafe("group selected", () => groupSelectedTokens(tokenId));
    });
    column.appendChild(button);
  });
}
