/**
 * @file The top-bar combat tracker: a full-width DOM overlay under #ui-top that
 * renders the active combat as a portrait strip via the pure buildTrackerView.
 * Re-renders on combat changes; each client renders its own bar for its own
 * user. Foundry boundary: not unit-tested (buildTrackerView is).
 */

import { MODULE_ID, SETTINGS } from "../constants";
import {
  buildTrackerView,
  type TrackerCombatant,
  type TrackerInput,
  type TrackerRow,
  type Viewer
} from "../logic/tracker-view";
import { openGroupHud } from "./group-hud";
import { groupColor } from "./groups";
import { isActiveGM } from "./hooks";
import { findCombatant } from "./lookup";
import { readCombatantTag } from "./tags";

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
    groupId: typeof combatant.group === "string" && combatant.group ? combatant.group : null,
    hidden: combatant.hidden,
    isDefeated: combatant.isDefeated,
    ownedByViewer: owned,
    hp: { value: typeof hp?.value === "number" ? hp.value : null, max: typeof hp?.max === "number" ? hp.max : null },
    conditions: actor?.statuses ? [...actor.statuses] : []
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

/** Get or create the bar container under #ui-top (falling back to body). */
function container(): HTMLElement {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) return existing;
  const element = document.createElement("div");
  element.id = CONTAINER_ID;
  element.className = `${MODULE_ID}-top-bar`;
  (document.getElementById("ui-top") ?? document.body).appendChild(element);
  return element;
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
    li.title = row.name;
  } else {
    li.dataset["groupId"] = row.groupId;
    li.style.borderColor = row.color;
    if (row.img) li.style.backgroundImage = `url("${row.img}")`;
    const badge = document.createElement("span");
    badge.className = `${MODULE_ID}-tb-count`;
    badge.textContent = `x${row.memberCount}`;
    li.appendChild(badge);
    li.addEventListener("click", () => {
      const combat = game.combats?.active ?? null;
      if (combat) openGroupHud(combat, row.groupId);
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
      if (isActiveGM()) void run();
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
    const element = container();
    const combat = game.combats?.active ?? null;
    if (!combat || !enabled()) {
      element.hidden = true;
      element.replaceChildren();
      return;
    }
    const rows = buildTrackerView(toInput(combat), viewer());
    element.replaceChildren(...rows.map(renderRow));
    if (game.user?.isGM === true) element.appendChild(renderControls(combat));
    element.hidden = false;
  } catch (error) {
    console.error(`${MODULE_ID} | top-bar render`, error);
  }
}

/**
 * Register the top-bar tracker: create the container and re-render it on every
 * combat change. Interactions and turn controls are added by the same module in
 * Task 3.
 */
export function registerTopBar(): void {
  Hooks.once("ready", render);
  for (const hook of ["updateCombat", "updateCombatant", "createCombatant", "deleteCombatant", "deleteCombat"]) {
    Hooks.on(hook, () => {
      render();
    });
  }
}
