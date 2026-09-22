/**
 * @file Module entry point. Bundled by esbuild to `scripts/main.js`, which is the
 * file Foundry loads via the `esmodules` manifest entry. Registers settings, the
 * player-choice query handler, runtime hooks, and the tag UIs at `init`.
 */

import { registerCombatEvents } from "./adapter/combat-events";
import { registerGroupUI } from "./adapter/group-ui";
import { registerGroupingKeybinding, registerTokenHudButton } from "./adapter/grouping-ui";
import { registerGroupTurns } from "./adapter/group-turns";
import { registerTopBar } from "./adapter/top-bar";
import { registerHooks } from "./adapter/hooks";
import { registerQueryHandler } from "./adapter/player-query";
import {
  registerActorDirectoryContextMenu,
  registerSheetTagControl,
  registerTrackerContextMenu
} from "./adapter/tagging-ui";
import { MODULE_ID } from "./constants";
import { registerSettings } from "./settings";

Hooks.once("init", (): void => {
  registerSettings();
  registerQueryHandler();
  registerHooks();
  registerGroupTurns();
  registerCombatEvents();
  registerTrackerContextMenu();
  registerActorDirectoryContextMenu();
  registerSheetTagControl();
  registerGroupUI();
  registerGroupingKeybinding();
  registerTokenHudButton();
  registerTopBar();
  console.log(`${MODULE_ID} | initialized`);
});
