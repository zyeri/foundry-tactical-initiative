/**
 * @file The top-bar combat tracker: a full-width DOM overlay under #ui-top that
 * renders the active combat as a portrait strip via the pure buildTrackerView.
 * Re-renders on combat changes; each client renders its own bar for its own
 * user. Foundry boundary: not unit-tested (buildTrackerView is).
 */

import { MODULE_ID, SETTINGS } from "../constants";
import { groupIdOf } from "../logic/group";
import { BAR_DEFAULT, BAR_MAX, BAR_MIN, clampBarSize } from "../logic/bar-size";
import {
  buildTrackerView,
  type TrackerCombatant,
  type TrackerInput,
  type TrackerRow,
  type Viewer
} from "../logic/tracker-view";
import { openGroupHud } from "./group-hud";
import { pushGroupOptions, recolorGroupInteractive, renameGroupInteractive } from "./group-ui";
import { disbandGroup, groupColor } from "./groups";
import { isActiveGM } from "./hooks";
import { findCombatant } from "./lookup";
import { getTopBarSize } from "../settings";
import { pushTagOptions } from "./tagging-ui";
import { readCombatantTag } from "./tags";
import { attachGrip } from "../ui/grip";
import { openMenu as openUiMenu, type MenuItem } from "../ui/menu";
import { runSafe } from "../ui/run-safe";

/** The id of the bar container element. */
const CONTAINER_ID = `${MODULE_ID}-top-bar`;

/** Whether the bar is enabled by setting. */
function enabled(): boolean {
  return game.settings.get(MODULE_ID, SETTINGS.ENABLE_TOP_BAR) === true;
}

/** The current viewer descriptor. */
function viewer(): Viewer {
  const policy = game.settings.get(MODULE_ID, SETTINGS.PLAYER_HP_POLICY);
  return {
    isGM: game.user?.isGM === true,
    playerHpPolicy: policy === "none" ? "none" : "bar"
  };
}

/** Map one Foundry combatant to a plain TrackerCombatant. */
function toCombatant(combatant: FoundryCombatant): TrackerCombatant {
  const actor = combatant.actor;
  const hp = actor?.system?.attributes?.hp;
  const owned = actor && game.user ? actor.testUserPermission(game.user, "OWNER") : false;
  return {
    id: combatant.id,
    name: combatant.name,
    img: combatant.img ?? null,
    initiative: combatant.initiative,
    tag: readCombatantTag(combatant),
    groupId: groupIdOf(combatant),
    hidden: combatant.hidden,
    isDefeated: combatant.isDefeated,
    ownedByViewer: owned,
    hp: { value: typeof hp?.value === "number" ? hp.value : null, max: typeof hp?.max === "number" ? hp.max : null },
    conditions: actor?.statuses ? [...actor.statuses] : [],
    tokenMissing:
      combatant.sceneId !== null &&
      combatant.tokenId !== null &&
      game.scenes?.get(combatant.sceneId)?.tokens.has(combatant.tokenId) === false
  };
}

/** Read the active combat into a TrackerInput. */
function toInput(combat: FoundryCombat): TrackerInput {
  return {
    combatants: combat.turns.map(toCombatant),
    groups: combat.groups.contents.map((group) => ({ id: group.id, name: group.name, color: groupColor(group) })),
    currentId: combat.combatant?.id ?? null
  };
}

/** Class of the scrolling strip that render() rebuilds. */
const STRIP_CLASS = `${MODULE_ID}-tb-strip`;

/** The size currently applied to the bar, px. */
let barSize = BAR_DEFAULT;

/** Apply a portrait size to the bar wrapper. */
function applySize(bar: HTMLElement, px: number): void {
  bar.style.setProperty("--ti-portrait", `${px}px`);
}

/**
 * Get or create the bar: a persistent wrapper under #ui-top (falling back to
 * body) holding a strip that render() rebuilds and a persistent resize grip.
 *
 * @returns The wrapper and its strip.
 */
function container(): { bar: HTMLElement; strip: HTMLElement } {
  const existing = document.getElementById(CONTAINER_ID);
  const existingStrip = existing?.querySelector<HTMLElement>(`.${STRIP_CLASS}`);
  if (existing && existingStrip) return { bar: existing, strip: existingStrip };
  const bar = document.createElement("div");
  bar.id = CONTAINER_ID;
  bar.className = `${MODULE_ID}-top-bar`;
  const strip = document.createElement("div");
  strip.className = STRIP_CLASS;
  const grip = document.createElement("div");
  grip.className = `${MODULE_ID}-tb-grip`;
  grip.title = game.i18n.localize("TACTICAL_INITIATIVE.Tracker.ResizeGrip");
  bar.append(strip, grip);
  barSize = getTopBarSize();
  applySize(bar, barSize);
  attachGrip(grip, {
    read: () => barSize,
    preview: (px) => {
      barSize = px;
      applySize(bar, px);
    },
    commit: (px) => {
      void runSafe("top-bar size", () => game.settings.set(MODULE_ID, SETTINGS.TOP_BAR_SIZE, px));
    },
    clamp: clampBarSize,
    min: BAR_MIN,
    max: BAR_MAX,
    defaultSize: BAR_DEFAULT,
    step: 4
  });
  (document.getElementById("ui-top") ?? document.body).appendChild(bar);
  return { bar, strip };
}

/** Pan to and control a combatant's token (GM or owner). */
function focusToken(combatantId: string): void {
  const location = findCombatant(combatantId);
  const tokenId = location?.combatant.tokenId ?? null;
  if (!tokenId) return;
  const token = canvas.tokens?.get(tokenId);
  token?.control({ releaseOthers: true });
  if (token?.center) canvas.pan?.({ x: token.center.x, y: token.center.y });
}

/** Open the actor sheet for a combatant. */
function openSheet(combatantId: string): void {
  findCombatant(combatantId)?.combatant.actor?.sheet?.render(true);
}

/** A context-menu entry shape shared with the tag/group builders. */
interface MenuEntry {
  name: string;
  icon: string;
  condition: (target?: unknown) => boolean;
  callback: (target: unknown) => void;
}

/** Menu element id and class for the bar's context menu. */
const MENU_ID = `${MODULE_ID}-tb-menu`;
const MENU_CLASS = `${MODULE_ID}-tb-menu`;

/**
 * Open the combatant-row context menu, reusing the sidebar tag/group builders.
 *
 * @param rowEl - The combatant row element (carries `data-combatant-id`).
 * @param x - Viewport x.
 * @param y - Viewport y.
 */
function openCombatantMenu(rowEl: HTMLElement, x: number, y: number): void {
  const entries: MenuEntry[] = [];
  pushTagOptions(entries);
  pushGroupOptions(entries);
  const items: MenuItem[] = entries
    .filter((entry) => {
      try {
        return entry.condition(rowEl);
      } catch {
        return false;
      }
    })
    .map((entry) => ({ label: entry.name, run: () => entry.callback(rowEl) }));
  openUiMenu(document, MENU_ID, MENU_CLASS, items, x, y);
}

/** Group ids whose member popover is open; survives redraws. */
const expandedGroups = new Set<string>();

/** Popover element class. */
const POPOVER_CLASS = `${MODULE_ID}-tb-members`;

/**
 * Open the group-cell context menu (GM only): rename, recolor, HUD, disband.
 *
 * @param groupId - The group id.
 * @param x - Viewport x.
 * @param y - Viewport y.
 */
function openGroupMenu(groupId: string, x: number, y: number): void {
  const combat = game.combats?.active ?? null;
  if (!combat || game.user?.isGM !== true) return;
  const items: MenuItem[] = [
    { label: game.i18n.localize("TACTICAL_INITIATIVE.Group.Rename"), run: () => renameGroupInteractive(combat, groupId) },
    { label: game.i18n.localize("TACTICAL_INITIATIVE.Group.Recolor"), run: () => recolorGroupInteractive(combat, groupId) },
    { label: game.i18n.localize("TACTICAL_INITIATIVE.HUD.Open"), run: () => openGroupHud(combat, groupId) },
    { label: game.i18n.localize("TACTICAL_INITIATIVE.Group.Disband"), run: () => disbandGroup(combat, groupId) }
  ];
  openUiMenu(document, MENU_ID, MENU_CLASS, items, x, y);
}

/**
 * Redraw member popovers for expanded groups, anchored under their cells.
 * Popovers live on document.body so the bar's scroll box cannot clip them.
 *
 * @param bar - The bar container.
 * @param rows - The rows just rendered.
 */
function renderPopovers(bar: HTMLElement, rows: readonly TrackerRow[]): void {
  document.querySelectorAll(`.${POPOVER_CLASS}`).forEach((el) => el.remove());
  const present = new Set(rows.flatMap((row) => (row.kind === "group" ? [row.groupId] : [])));
  for (const id of [...expandedGroups]) if (!present.has(id)) expandedGroups.delete(id);
  for (const row of rows) {
    if (row.kind !== "group" || !expandedGroups.has(row.groupId)) continue;
    const cell = bar.querySelector<HTMLElement>(`[data-group-id="${row.groupId}"]`);
    if (!cell) continue;
    const rect = cell.getBoundingClientRect();
    const pop = document.createElement("div");
    pop.className = POPOVER_CLASS;
    pop.style.left = `${rect.left}px`;
    pop.style.top = `${rect.bottom + 4}px`;
    pop.style.borderColor = row.color;
    for (const member of row.members) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `${POPOVER_CLASS}-item`;
      if (member.defeated) button.classList.add(`${MODULE_ID}-tb-defeated`);
      if (member.img) {
        const img = document.createElement("img");
        img.src = member.img;
        img.alt = "";
        button.appendChild(img);
      }
      button.appendChild(document.createTextNode(member.name));
      button.addEventListener("click", () => {
        focusToken(member.id);
      });
      pop.appendChild(button);
    }
    document.body.appendChild(pop);
  }
}

/** Build one combatant or group row element (interactions added in Task 3). */
function renderRow(row: TrackerRow): HTMLElement {
  const li = document.createElement("div");
  li.className = `${MODULE_ID}-tb-row ${MODULE_ID}-tb-${row.kind}`;
  if (row.isCurrent) li.classList.add(`${MODULE_ID}-tb-current`);
  if (row.kind === "combatant") {
    li.dataset["combatantId"] = row.combatantId;
    if (row.isDefeated) li.classList.add(`${MODULE_ID}-tb-defeated`);
    if (row.img) li.style.backgroundImage = `url("${row.img}")`;
    if (row.hp.shown !== "none" && row.hp.value !== null && row.hp.max !== null && row.hp.max > 0) {
      const bar = document.createElement("div");
      bar.className = `${MODULE_ID}-tb-hp`;
      bar.style.width = `${Math.max(0, Math.min(100, (row.hp.value / row.hp.max) * 100))}%`;
      li.appendChild(bar);
      if (row.hp.shown === "full") {
        const text = document.createElement("span");
        text.className = `${MODULE_ID}-tb-hp-text`;
        text.textContent = `${row.hp.value}/${row.hp.max}`;
        li.appendChild(text);
      }
    }
    if (row.conditions.length > 0) {
      const cond = document.createElement("span");
      cond.className = `${MODULE_ID}-tb-cond`;
      cond.textContent = String(row.conditions.length);
      cond.title = row.conditions.join(", ");
      li.appendChild(cond);
    }
    li.addEventListener("click", () => {
      focusToken(row.combatantId);
    });
    li.addEventListener("dblclick", () => {
      openSheet(row.combatantId);
    });
    li.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openCombatantMenu(li, event.clientX, event.clientY);
    });
    li.title = row.name;
  } else {
    li.dataset["groupId"] = row.groupId;
    li.style.borderColor = row.color;
    const stack = document.createElement("div");
    stack.className = `${MODULE_ID}-tb-stack`;
    row.portraits.forEach((src, index) => {
      const face = document.createElement("div");
      face.className = `${MODULE_ID}-tb-stack-img`;
      face.style.backgroundImage = `url("${src}")`;
      face.style.setProperty("--ti-stack-i", String(index));
      stack.appendChild(face);
    });
    li.appendChild(stack);
    const badge = document.createElement("span");
    badge.className = `${MODULE_ID}-tb-count`;
    badge.textContent = row.living < row.memberCount ? `x${row.living}/${row.memberCount}` : `x${row.memberCount}`;
    li.appendChild(badge);
    const label = document.createElement("span");
    label.className = `${MODULE_ID}-tb-group-name`;
    label.textContent = row.name;
    li.appendChild(label);
    if (expandedGroups.has(row.groupId)) li.classList.add(`${MODULE_ID}-tb-expanded`);
    li.addEventListener("click", () => {
      if (expandedGroups.has(row.groupId)) expandedGroups.delete(row.groupId);
      else expandedGroups.add(row.groupId);
      render();
    });
    li.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openGroupMenu(row.groupId, event.clientX, event.clientY);
    });
    li.title = row.name;
  }
  return li;
}

/** Build the GM turn-control cluster (previous/next turn, next round, end, round no.). */
function renderControls(combat: FoundryCombat): HTMLElement {
  const bar = document.createElement("div");
  bar.className = `${MODULE_ID}-tb-controls`;
  const round = document.createElement("span");
  round.className = `${MODULE_ID}-tb-round`;
  round.textContent = game.i18n.format("TACTICAL_INITIATIVE.Tracker.Round", { n: String(combat.round) });
  bar.appendChild(round);
  const button = (action: string, icon: string, key: string, run: () => Promise<unknown>): void => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `${MODULE_ID}-tb-btn`;
    el.dataset["tbAction"] = action;
    const glyph = document.createElement("i");
    glyph.className = `fas ${icon}`;
    el.appendChild(glyph);
    el.title = game.i18n.localize(key);
    el.addEventListener("click", () => {
      if (isActiveGM()) void runSafe(`turn:${action}`, run);
    });
    bar.appendChild(el);
  };
  button("prev", "fa-backward-step", "TACTICAL_INITIATIVE.Tracker.PrevTurn", () => combat.previousTurn());
  button("next", "fa-forward-step", "TACTICAL_INITIATIVE.Tracker.NextTurn", () => combat.nextTurn());
  button("round", "fa-forward", "TACTICAL_INITIATIVE.Tracker.NextRound", () => combat.nextRound());
  button("end", "fa-flag-checkered", "TACTICAL_INITIATIVE.Tracker.EndCombat", () => combat.endCombat());
  return bar;
}

/** Render (or hide) the bar for the active combat. */
function render(): void {
  try {
    const { bar, strip } = container();
    applySize(bar, barSize);
    const combat = game.combats?.active ?? null;
    if (!combat || !enabled()) {
      bar.hidden = true;
      strip.replaceChildren();
      document.querySelectorAll(`.${POPOVER_CLASS}`).forEach((el) => el.remove());
      return;
    }
    const rows = buildTrackerView(toInput(combat), viewer());
    strip.replaceChildren(...rows.map(renderRow));
    if (game.user?.isGM === true) strip.appendChild(renderControls(combat));
    bar.hidden = false;
    renderPopovers(strip, rows);
  } catch (error) {
    console.error(`${MODULE_ID} | top-bar render`, error);
  }
}

/**
 * Close every open group popover and re-render, if any were open. Shared by the
 * outside-click and Escape listeners.
 */
function closeAllPopovers(): void {
  if (expandedGroups.size === 0) return;
  expandedGroups.clear();
  render();
}

/**
 * Register the document-level listeners that close an open group popover on an
 * outside click or Escape. Registered once from {@link registerTopBar}, not per
 * render, so repeated redraws don't pile up duplicate listeners. A capture-phase
 * `pointerdown` outside every `.tactical-initiative-tb-members` popover element
 * and outside any group cell (`[data-group-id]`) closes the popover; clicking a
 * member inside a popover, or the group cell that opened it, is left alone so
 * the existing toggle/pan behavior keeps working.
 */
function registerPopoverDismissal(): void {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (expandedGroups.size === 0) return;
      const target = event.target instanceof Node ? event.target : null;
      if (target && (target as Element).closest?.(`.${POPOVER_CLASS}, [data-group-id]`)) return;
      closeAllPopovers();
    },
    true
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllPopovers();
  });
}

/**
 * Register the top-bar tracker: create the container and re-render it on every
 * combat change. Interactions and turn controls are added by the same module in
 * Task 3.
 */
export function registerTopBar(): void {
  Hooks.once("ready", render);
  registerPopoverDismissal();
  const redrawOn = [
    "createCombat",
    "updateCombat",
    "deleteCombat",
    "createCombatant",
    "updateCombatant",
    "deleteCombatant",
    "createCombatantGroup",
    "updateCombatantGroup",
    "deleteCombatantGroup",
    "updateActor",
    "createToken",
    "deleteToken"
  ];
  for (const hook of redrawOn) {
    Hooks.on(hook, () => {
      render();
    });
  }
}
