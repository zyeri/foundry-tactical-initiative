/**
 * @file Module entry point. Bundled by esbuild to `scripts/main.js`, which is the
 * file Foundry loads via the `esmodules` manifest entry. Registers settings, the
 * player-choice query handler, runtime hooks, and the tag UIs at `init`.
 */

import { registerHooks } from "./adapter/hooks";
import { registerQueryHandler } from "./adapter/player-query";
import { registerSheetTagControl, registerTrackerContextMenu } from "./adapter/tagging-ui";
import { MODULE_ID } from "./constants";
import { registerSettings } from "./settings";

Hooks.once("init", (): void => {
  registerSettings();
  registerQueryHandler();
  registerHooks();
  registerTrackerContextMenu();
  registerSheetTagControl();
  console.log(`${MODULE_ID} | initialized`);
});
