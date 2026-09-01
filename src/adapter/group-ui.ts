/**
 * @file Group UI: combat-tracker context-menu entries to create and manage
 * combatant groups (add the ctrl-selected rows to a new group, remove, rename,
 * recolor, disband) plus a colored group tag rendered on each grouped row.
 * Mirrors the robust tracker-context wrap in tagging-ui.ts so it works with
 * replacement trackers. Foundry boundary: not unit-tested; manual checklist.
 */

import { MODULE_ID } from "../constants";
import {
  addToGroup,
  DEFAULT_GROUP_COLOR,
  disbandGroup,
  groupColor,
  recolorGroup,
  removeFromGroup,
  renameGroup
} from "./groups";
import { findCombatant } from "./lookup";

/** A combat-tracker context-menu entry (Foundry's `ContextMenuEntry`, subset). */
interface ContextMenuEntry {
  name: string;
  icon: string;
  condition: (target?: unknown) => boolean;
  callback: (target: unknown) => void;
}

/**
 * Resolve a raw `HTMLElement` from a jQuery-like or element value. Duplicated
 * from tagging-ui.ts to keep this Foundry-boundary module self-contained.
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
 * Extract a combatant id from a context-menu callback target.
 *
 * @param target - The callback target (element or jQuery wrapper).
 * @returns The combatant id, or `null`.
 */
function combatantIdFromTarget(target: unknown): string | null {
  const element = resolveElement(target);
  const id = element?.dataset["combatantId"];
  return typeof id === "string" ? id : null;
}

/**
 * The combatant ids the GM wants to group: the ctrl-selected tracker rows if the
 * active tracker exposes a multi-selection, always including the right-clicked
 * row. The exact selected-row signal is a live probe (README), so this reads a
 * generous set of candidate selectors and falls back to the clicked row alone.
 *
 * @param target - The context-menu callback target.
 * @returns The combatant ids to group (at least the clicked one).
 */
function selectedCombatantIds(target: unknown): string[] {
  const ids = new Set<string>();
  const clicked = combatantIdFromTarget(target);
  if (clicked) ids.add(clicked);
  try {
    const element = resolveElement(target);
    const tracker =
      element?.closest<HTMLElement>("#combat, .combat-tracker, section.combat, [data-tab='combat']") ??
      element?.ownerDocument.body ??
      null;
    const selected = tracker?.querySelectorAll<HTMLElement>(
      ".combatant.selected, li.combatant[aria-selected='true'], .combatant.active-selection"
    );
    selected?.forEach((row) => {
      const id = row.dataset["combatantId"];
      if (typeof id === "string" && id.length > 0) ids.add(id);
    });
  } catch {
    // Best-effort multi-select; the clicked row is always included above.
  }
  return [...ids];
}

/**
 * The group id of the right-clicked combatant, or `null` when it is ungrouped.
 *
 * @param target - The context-menu callback target.
 * @returns The group id, or `null`.
 */
function clickedGroupId(target: unknown): string | null {
  const id = combatantIdFromTarget(target);
  if (!id) return null;
  const location = findCombatant(id);
  const group = location && typeof location.combatant.group === "string" ? location.combatant.group : null;
  return group && group.length > 0 ? group : null;
}

/** Whether the right-clicked combatant is in a group (menu-visibility guard). */
function isGrouped(target?: unknown): boolean {
  return clickedGroupId(target) !== null;
}

/**
 * Escape a string for safe interpolation into an HTML attribute value.
 *
 * @param value - The raw string.
 * @returns The escaped string.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Read the `value` field of a DialogV2 prompt's submit-button form.
 *
 * @param button - The submit button (its `form` owns the input).
 * @returns The input value, or `""`.
 */
function readDialogValue(button: HTMLButtonElement): string {
  const field = button.form?.elements.namedItem("value");
  return field instanceof HTMLInputElement ? field.value : "";
}

/**
 * Prompt the GM for a single line of text, pre-filled with `current`.
 *
 * @param titleKey - i18n key for the dialog title.
 * @param current - The value to pre-fill.
 * @returns The entered text, or `null` if the dialog was dismissed.
 */
async function promptForText(titleKey: string, current: string): Promise<string | null> {
  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(titleKey) },
      modal: true,
      content: `<input type="text" name="value" value="${escapeAttribute(current)}" style="width:100%" autofocus>`,
      ok: {
        action: "ok",
        callback: (_event: Event, button: HTMLButtonElement): string => readDialogValue(button).trim()
      }
    });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

/**
 * Prompt the GM for a color, pre-filled with `current`.
 *
 * @param current - The current color (CSS hex).
 * @returns The chosen color, or `null` if the dialog was dismissed.
 */
async function promptForColor(current: string): Promise<string | null> {
  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("TACTICAL_INITIATIVE.Group.Recolor") },
      modal: true,
      content: `<input type="color" name="value" value="${escapeAttribute(current)}" autofocus>`,
      ok: {
        action: "ok",
        callback: (_event: Event, button: HTMLButtonElement): string => readDialogValue(button)
      }
    });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

/**
 * Create a new group from the ctrl-selected tracker rows (or the clicked row).
 *
 * @param target - The context-menu callback target.
 */
async function addSelectionToNewGroup(target: unknown): Promise<void> {
  const id = combatantIdFromTarget(target);
  if (!id) return;
  const location = findCombatant(id);
  if (!location) return;
  await addToGroup(location.combat, selectedCombatantIds(target), null);
}

/**
 * Remove the right-clicked combatant from its group.
 *
 * @param target - The context-menu callback target.
 */
async function removeClickedFromGroup(target: unknown): Promise<void> {
  const id = combatantIdFromTarget(target);
  if (!id) return;
  const location = findCombatant(id);
  if (!location) return;
  await removeFromGroup(location.combat, [id]);
}

/**
 * Rename the right-clicked combatant's group.
 *
 * @param target - The context-menu callback target.
 */
async function renameClickedGroup(target: unknown): Promise<void> {
  const id = combatantIdFromTarget(target);
  const groupId = clickedGroupId(target);
  if (!id || !groupId) return;
  const location = findCombatant(id);
  if (!location) return;
  const current = location.combat.groups.get(groupId)?.name ?? "";
  const name = await promptForText("TACTICAL_INITIATIVE.Group.Rename", current);
  if (name !== null && name.length > 0) await renameGroup(location.combat, groupId, name);
}

/**
 * Recolor the right-clicked combatant's group tag.
 *
 * @param target - The context-menu callback target.
 */
async function recolorClickedGroup(target: unknown): Promise<void> {
  const id = combatantIdFromTarget(target);
  const groupId = clickedGroupId(target);
  if (!id || !groupId) return;
  const location = findCombatant(id);
  if (!location) return;
  const group = location.combat.groups.get(groupId);
  const current = group ? groupColor(group) : DEFAULT_GROUP_COLOR;
  const color = await promptForColor(current);
  if (color !== null && color.length > 0) await recolorGroup(location.combat, groupId, color);
}

/**
 * Disband the right-clicked combatant's group.
 *
 * @param target - The context-menu callback target.
 */
async function disbandClickedGroup(target: unknown): Promise<void> {
  const id = combatantIdFromTarget(target);
  const groupId = clickedGroupId(target);
  if (!id || !groupId) return;
  const location = findCombatant(id);
  if (!location) return;
  await disbandGroup(location.combat, groupId);
}

/**
 * Push this module's group-management options onto a tracker context menu.
 * "Add to group" is always available (GM); the rest show only on a grouped row.
 *
 * @param options - The context-menu entry array to append to.
 */
function pushGroupOptions(options: ContextMenuEntry[]): void {
  const isGM = (): boolean => game.user?.isGM === true;
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.AddTo"),
    icon: `<i class="fas fa-object-group"></i>`,
    condition: (): boolean => isGM(),
    callback: (target: unknown): void => {
      void addSelectionToNewGroup(target);
    }
  });
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.Remove"),
    icon: `<i class="fas fa-object-ungroup"></i>`,
    condition: (target?: unknown): boolean => isGM() && isGrouped(target),
    callback: (target: unknown): void => {
      void removeClickedFromGroup(target);
    }
  });
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.Rename"),
    icon: `<i class="fas fa-pen"></i>`,
    condition: (target?: unknown): boolean => isGM() && isGrouped(target),
    callback: (target: unknown): void => {
      void renameClickedGroup(target);
    }
  });
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.Recolor"),
    icon: `<i class="fas fa-palette"></i>`,
    condition: (target?: unknown): boolean => isGM() && isGrouped(target),
    callback: (target: unknown): void => {
      void recolorClickedGroup(target);
    }
  });
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.Disband"),
    icon: `<i class="fas fa-users-slash"></i>`,
    condition: (target?: unknown): boolean => isGM() && isGrouped(target),
    callback: (target: unknown): void => {
      void disbandClickedGroup(target);
    }
  });
}

/** Marker so the tracker prototype is wrapped for group options only once. */
const GROUP_CONTEXT_PATCHED = "__tacticalInitiativeGroupContextPatched";

/** The tracker method that returns combatant context-menu entries. */
const ENTRY_CONTEXT_METHOD = "_getEntryContextOptions";

/**
 * Resolve the combat-tracker prototype that owns {@link ENTRY_CONTEXT_METHOD},
 * preferring the registered tracker class and falling back to the live sidebar
 * instance. Duplicated from tagging-ui.ts to keep this module self-contained.
 *
 * @returns The prototype object, or `null`.
 */
function trackerPrototype(): Record<string, unknown> | null {
  const config = CONFIG as unknown as { ui?: { combat?: { prototype?: unknown } } };
  const fromClass = config.ui?.combat?.prototype;
  if (fromClass && typeof fromClass === "object") return fromClass as Record<string, unknown>;
  const directory = (game as unknown as { combats?: { directory?: unknown } | null }).combats?.directory;
  return directory ? (Object.getPrototypeOf(directory) as Record<string, unknown>) : null;
}

/**
 * Wrap the tracker's entry-options method so group options appear on every
 * tracker that builds its menu from it (core sidebar + replacement trackers).
 *
 * @returns `true` if wrapped (or already wrapped); `false` if unavailable.
 */
function tryPatchTracker(): boolean {
  try {
    const proto = trackerPrototype();
    if (!proto) return false;
    if (proto[GROUP_CONTEXT_PATCHED] === true) return true;
    const original = proto[ENTRY_CONTEXT_METHOD];
    if (typeof original !== "function") return false;
    const wrapped = original as (...args: unknown[]) => ContextMenuEntry[];
    proto[ENTRY_CONTEXT_METHOD] = function (this: unknown, ...args: unknown[]): ContextMenuEntry[] {
      const entries = wrapped.apply(this, args) ?? [];
      pushGroupOptions(entries);
      return entries;
    };
    proto[GROUP_CONTEXT_PATCHED] = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Render a colored group tag on each grouped combatant row. Best-effort and
 * idempotent; wrapped so a failure never breaks the tracker render. Whether the
 * core tracker also renders native group rows is a live probe (README); this
 * decorates member rows, which exist regardless.
 *
 * @param root - The tracker root element.
 */
function decorateTrackerGroups(root: HTMLElement): void {
  try {
    const combat = game.combats?.active ?? null;
    if (!combat) return;
    const rows = root.querySelectorAll<HTMLElement>(".combatant[data-combatant-id]");
    rows.forEach((row) => {
      const id = row.dataset["combatantId"];
      if (typeof id !== "string" || id.length === 0) return;
      const combatant = combat.combatants.get(id);
      const groupId = combatant && typeof combatant.group === "string" ? combatant.group : null;
      if (!groupId || groupId.length === 0) return;
      const group = combat.groups.get(groupId);
      if (!group) return;
      if (row.querySelector(`.${MODULE_ID}-group-tag`)) return;
      const tag = document.createElement("span");
      tag.className = `${MODULE_ID}-group-tag`;
      tag.textContent = group.name;
      tag.title = group.name;
      tag.style.backgroundColor = groupColor(group);
      const anchor = row.querySelector<HTMLElement>(".token-name, .combatant-name, .name") ?? row;
      anchor.appendChild(tag);
    });
  } catch {
    // Best-effort decoration; never break the tracker render.
  }
}

/**
 * Register the group tracker UI: the context-menu options (via the robust
 * prototype wrap, falling back to the `getCombatantContextOptions` hook fired by
 * the core sidebar tracker only) and the colored group tag on each grouped row.
 */
export function registerGroupUI(): void {
  Hooks.once("ready", (): void => {
    if (tryPatchTracker()) return;
    Hooks.on("getCombatantContextOptions", (_appOrHtml: unknown, options: ContextMenuEntry[]): void => {
      pushGroupOptions(options);
    });
  });
  Hooks.on("renderCombatTracker", (_app: unknown, html: unknown): void => {
    const root = resolveElement(html);
    if (root) decorateTrackerGroups(root);
  });
}
