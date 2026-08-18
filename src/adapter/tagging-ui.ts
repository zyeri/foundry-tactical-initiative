/**
 * @file Tag UI: a right-click context menu on combat-tracker entries (the
 * guaranteed path) plus a best-effort tag dropdown injected into the actor sheet
 * header. The exact v13/dnd5e sheet hook and DOM are uncertain, so the sheet
 * injection is defensive and logged in the README assumptions.
 */

import { MODULE_ID, TAGS, type Tag } from "../constants";
import { reconcileBossOnRetag } from "./boss-slots";
import { findCombatant } from "./lookup";
import { readActorTag, writeActorTag } from "./tags";

/** A combat-tracker context-menu entry (Foundry's `ContextMenuEntry`, subset). */
interface ContextMenuEntry {
  name: string;
  icon: string;
  condition: () => boolean;
  callback: (target: unknown) => void;
}

/**
 * Extract a combatant id from a context-menu callback target, which may be a
 * jQuery object or a raw element.
 *
 * @param target - The callback target.
 * @returns The combatant id, or `null`.
 */
function combatantIdFromTarget(target: unknown): string | null {
  const element = resolveElement(target);
  const id = element?.dataset["combatantId"];
  return typeof id === "string" ? id : null;
}

/**
 * Resolve a raw `HTMLElement` from a jQuery-like or element value.
 *
 * @param value - A jQuery object, an element, or something else.
 * @returns The underlying element, or `null`.
 */
function resolveElement(value: unknown): HTMLElement | null {
  if (value instanceof HTMLElement) return value;
  const jqueryLike = value as { 0?: unknown } | null;
  const first = jqueryLike?.[0];
  return first instanceof HTMLElement ? first : null;
}

/**
 * Retag the combatant's actor, then reconcile boss slots so the change takes
 * effect at the next roll (and boss pairs are created/removed as needed).
 *
 * @param combatantId - The tracker entry's combatant id.
 * @param tag - The new tag.
 */
async function retagCombatant(combatantId: string, tag: Tag): Promise<void> {
  const location = findCombatant(combatantId);
  if (!location?.combatant.actor) return;
  await writeActorTag(location.combatant.actor, tag);
  await reconcileBossOnRetag(location.combatant, location.combat);
}

/**
 * Push this module's tag options onto a combat-tracker combatant context menu.
 * The second hook argument is the options array in both the legacy and current
 * signatures; per-entry callbacks receive the row (element or jQuery), which
 * {@link combatantIdFromTarget} resolves either way.
 *
 * @param options - The context-menu entry array to append to.
 */
function pushTagOptions(options: ContextMenuEntry[]): void {
  for (const tag of TAGS) {
    options.push({
      name: game.i18n.format("TACTICAL_INITIATIVE.Menu.TagAs", {
        tag: game.i18n.localize(`TACTICAL_INITIATIVE.Tag.${capitalize(tag)}`)
      }),
      icon: `<i class="fas fa-flag"></i>`,
      condition: (): boolean => game.user?.isGM === true,
      callback: (target: unknown): void => {
        const id = combatantIdFromTarget(target);
        if (id) void retagCombatant(id, tag);
      }
    });
  }
}

/**
 * Register the combat-tracker context-menu options (GM only).
 *
 * The combatant-row context hook was renamed when the tracker moved to
 * ApplicationV2 in v13: `getCombatantContextOptions` is the current name, while
 * `getCombatTrackerEntryContext` was the v12 name. Both are registered so the
 * menu appears regardless of core version; a hook that no longer fires is inert.
 */
export function registerTrackerContextMenu(): void {
  const handler = (_appOrHtml: unknown, options: ContextMenuEntry[]): void => {
    pushTagOptions(options);
  };
  Hooks.on("getCombatantContextOptions", handler);
  Hooks.on("getCombatTrackerEntryContext", handler);
}

/**
 * Register the best-effort sheet-header tag dropdown. Fires on actor-sheet
 * renders; injects a labeled `<select>` into the window header if a header
 * element can be found. Failures are swallowed so a sheet always renders.
 */
export function registerSheetTagControl(): void {
  const handler = (app: unknown, html: unknown): void => {
    try {
      injectSheetControl(app, html);
    } catch {
      // Best-effort UI; the context menu is the guaranteed tagging path.
    }
  };
  Hooks.on("renderActorSheet", handler);
  Hooks.on("renderActorSheetV2", handler);
}

/**
 * Inject the tag dropdown into an actor sheet's header.
 *
 * @param app - The sheet application (expected to expose `.actor` and `.id`).
 * @param html - The sheet root (jQuery object or element).
 */
function injectSheetControl(app: unknown, html: unknown): void {
  if (game.user?.isGM !== true) return;
  const actor = (app as { actor?: FoundryActor | null }).actor ?? null;
  if (!actor) return;
  const root = resolveElement(html);
  const header = root?.querySelector<HTMLElement>(".window-header .window-title") ?? root?.querySelector<HTMLElement>(".window-header");
  if (!header || header.querySelector(`.${MODULE_ID}-tag-select`)) return;

  const current = readActorTag(actor);
  const select = document.createElement("select");
  select.className = `${MODULE_ID}-tag-select`;
  select.title = game.i18n.localize("TACTICAL_INITIATIVE.Menu.SheetTitle");
  for (const tag of TAGS) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = game.i18n.localize(`TACTICAL_INITIATIVE.Tag.${capitalize(tag)}`);
    if (tag === current) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    const value = select.value;
    if (value === "player" || value === "boss" || value === "mob") void writeActorTag(actor, value);
  });
  header.appendChild(select);
}

/**
 * Capitalize a tag for building an i18n key (`player` -> `Player`).
 *
 * @param tag - The tag.
 * @returns The tag with its first letter uppercased.
 */
function capitalize(tag: Tag): string {
  return `${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
}
