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
 * Extract an actor id from an Actors-directory context-menu target, which is
 * the directory entry element (or a jQuery wrapper of it). Directory entries
 * carry the id on `data-entry-id` (older builds: `data-document-id`).
 *
 * @param target - The callback target.
 * @returns The actor id, or `null`.
 */
function actorIdFromTarget(target: unknown): string | null {
  const element = resolveElement(target);
  if (!element) return null;
  const direct = element.dataset["entryId"] ?? element.dataset["documentId"];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const ancestor = element.closest<HTMLElement>("[data-entry-id]");
  const id = ancestor?.dataset["entryId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Tag an actor from the directory, then reconcile any combatant it owns in an
 * active combat so boss pairs are created/removed immediately.
 *
 * @param actorId - The tagged actor's id.
 * @param tag - The new tag.
 */
async function retagActor(actorId: string, tag: Tag): Promise<void> {
  const actor = game.actors?.get(actorId) ?? null;
  if (!actor) return;
  await writeActorTag(actor, tag);
  for (const combat of game.combats?.contents ?? []) {
    const combatant = combat.combatants.contents.find((c) => c.actorId === actorId);
    if (combatant) await reconcileBossOnRetag(combatant, combat);
  }
}

/**
 * Push the tag options (GM only) onto an Actors-directory context menu.
 *
 * @param options - The context-menu entry array to append to.
 */
function pushActorTagOptions(options: ContextMenuEntry[]): void {
  for (const tag of TAGS) {
    options.push({
      name: game.i18n.format("TACTICAL_INITIATIVE.Menu.TagAs", {
        tag: game.i18n.localize(`TACTICAL_INITIATIVE.Tag.${capitalize(tag)}`)
      }),
      icon: `<i class="fas fa-flag"></i>`,
      condition: (): boolean => game.user?.isGM === true,
      callback: (target: unknown): void => {
        const id = actorIdFromTarget(target);
        if (id) void retagActor(id, tag);
      }
    });
  }
}

/**
 * Register the Actors-directory right-click tag menu (GM only). This is the
 * sheet-independent tagging path: it works no matter which actor-sheet module
 * is active (core dnd5e, Tidy 5e, ...), unlike the best-effort sheet-header
 * dropdown. The hook was renamed to `getActorContextOptions` when the directory
 * became ApplicationV2 in v13; the legacy name is registered too and is inert
 * where it no longer fires.
 */
export function registerActorDirectoryContextMenu(): void {
  const handler = (_appOrHtml: unknown, options: ContextMenuEntry[]): void => {
    pushActorTagOptions(options);
  };
  Hooks.on("getActorContextOptions", handler);
  Hooks.on("getActorDirectoryEntryContext", handler);
}

/** Marker property so a tracker prototype is only wrapped once. */
const ENTRY_CONTEXT_PATCHED = "__tacticalInitiativeEntryContextPatched";

/** The tracker method that returns combatant context-menu entries. */
const ENTRY_CONTEXT_METHOD = "_getEntryContextOptions";

/**
 * Resolve the combat-tracker prototype that owns
 * {@link ENTRY_CONTEXT_METHOD}, preferring the registered tracker class and
 * falling back to the live sidebar instance.
 *
 * @returns The prototype object, or `null` if none can be found.
 */
function trackerPrototype(): Record<string, unknown> | null {
  const config = CONFIG as unknown as { ui?: { combat?: { prototype?: unknown } } };
  const fromClass = config.ui?.combat?.prototype;
  if (fromClass && typeof fromClass === "object") return fromClass as Record<string, unknown>;
  const directory = (game as unknown as { combats?: { directory?: unknown } | null }).combats?.directory;
  return directory ? (Object.getPrototypeOf(directory) as Record<string, unknown>) : null;
}

/**
 * Wrap `CombatTracker#_getEntryContextOptions` so the tag options appear on
 * every tracker that builds its combatant menu from that method - the core
 * sidebar tracker *and* alternative trackers (e.g. Carousel Combat Tracker)
 * that call it directly and never fire the `getCombatantContextOptions` hook.
 *
 * @returns `true` if the method was wrapped; `false` if no wrappable method was
 *   found (caller then falls back to the hook).
 */
function tryPatchTracker(): boolean {
  try {
    const proto = trackerPrototype();
    if (!proto) return false;
    if (proto[ENTRY_CONTEXT_PATCHED] === true) return true;
    const original = proto[ENTRY_CONTEXT_METHOD];
    if (typeof original !== "function") return false;
    const wrapped = original as (...args: unknown[]) => ContextMenuEntry[];
    proto[ENTRY_CONTEXT_METHOD] = function (this: unknown, ...args: unknown[]): ContextMenuEntry[] {
      const entries = wrapped.apply(this, args) ?? [];
      pushTagOptions(entries);
      return entries;
    };
    proto[ENTRY_CONTEXT_PATCHED] = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Make the combatant tag options (GM only) appear in the combat-tracker
 * context menu. Wraps the tracker's own entry-options method so the menu works
 * with both the core sidebar tracker and replacement trackers; if that method
 * is unavailable, falls back to the `getCombatantContextOptions` hook (fired by
 * the core sidebar tracker only).
 */
export function registerTrackerContextMenu(): void {
  Hooks.once("ready", () => {
    if (tryPatchTracker()) return;
    Hooks.on("getCombatantContextOptions", (_appOrHtml: unknown, options: ContextMenuEntry[]): void => {
      pushTagOptions(options);
    });
  });
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
