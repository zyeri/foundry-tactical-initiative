/* tactical-initiative — bundled by esbuild. Do not edit; edit src/*.ts. */

// src/constants.ts
var MODULE_ID = "tactical-initiative";
var FLAGS = {
  /** Actor flag holding the tactical {@link Tag} (`"player" | "boss" | "mob"`). */
  TAG: "tag",
  /** Combatant flag: which boss slot this entry represents (`"start" | "end"`). */
  BOSS_SLOT: "bossSlot",
  /** Combatant flag on an `"end"` slot: the id of its paired `"start"` combatant. */
  PRIMARY_ID: "primaryId",
  /** Combatant flag: stable ordering rank so multi-boss order matches at both ends. */
  BOSS_ORDER: "bossOrder",
  /** Combatant flag: `true` while the owning player's choice dialog is open. */
  CHOOSING: "choosing",
  /** ActiveEffect flag: marks an effect this module created (safe to auto-remove). */
  TEMP_EFFECT: "temp"
};
var TAGS = ["player", "boss", "mob"];
var CHOICES = ["rush", "march", "hunker"];
var CHOICE_INIT_ADJUST = {
  rush: 3,
  march: 0,
  hunker: -6
};
var CHOICE_EFFECT_MODIFIER = {
  rush: -1,
  march: 0,
  hunker: 2
};
var DND5E_BONUS_KEYS = [
  "system.bonuses.mwak.attack",
  "system.bonuses.rwak.attack",
  "system.bonuses.msak.attack",
  "system.bonuses.rsak.attack",
  "system.bonuses.abilities.check",
  "system.bonuses.abilities.save"
];
var ACTIVE_EFFECT_MODE_ADD = 2;
var ACTIVE_EFFECT_TYPE_ADD = "add";
var V14_GENERATION = 14;
var BOSS_START_BASE = 1e4;
var BOSS_END_BASE = -1e4;
var QUERY_CHOOSE = `${MODULE_ID}.chooseInitiative`;
var SETTINGS = {
  /** World setting: seconds to wait for a player's choice before defaulting to March. */
  PLAYER_TIMEOUT: "playerTimeoutSeconds"
};

// src/logic/boss.ts
function bossSlotInitiative(slot, rank) {
  const base = slot === "start" ? BOSS_START_BASE : BOSS_END_BASE;
  return base - rank;
}

// src/logic/initiative.ts
function initiativeAdjustment(choice) {
  return CHOICE_INIT_ADJUST[choice];
}
function normalizeChoice(raw) {
  return typeof raw === "string" && CHOICES.includes(raw) ? raw : "march";
}

// src/service.ts
var TacticalInitiative = class {
  /**
   * @param port - The Foundry seam used for all side effects.
   */
  constructor(port) {
    this.port = port;
  }
  /**
   * Reroll initiative for an entire combat: clear all existing values and temp
   * effects, then apply each combatant's tag behavior. Called at combat start
   * and at the start of every new round.
   *
   * @param combatId - The combat document id.
   */
  async rollForCombat(combatId) {
    const combatants = await this.port.listCombatants(combatId);
    for (const combatant of combatants) {
      await this.port.removeTempEffects(combatant.actorId);
      await this.port.clearInitiative(combatant.id);
    }
    const active = combatants.filter((c) => !c.isDefeated);
    const choices = await this.gatherPlayerChoices(active);
    for (const combatant of active) {
      await this.applyCombatant(combatant, choices.get(combatant.id));
    }
  }
  /**
   * Roll initiative for a single combatant using its tag behavior. Used when a
   * combatant joins mid-round; does not reset the rest of the combat.
   *
   * @param combatId - The combat document id.
   * @param combatantId - The joining combatant's id.
   */
  async rollForCombatant(combatId, combatantId) {
    const combatants = await this.port.listCombatants(combatId);
    const combatant = combatants.find((c) => c.id === combatantId);
    if (!combatant || combatant.isDefeated) return;
    const choices = await this.gatherPlayerChoices([combatant]);
    await this.applyCombatant(combatant, choices.get(combatant.id));
  }
  /**
   * Ask every player combatant (concurrently) for its choice, showing the
   * "choosing" indicator during the prompt. A `null` answer (offline or timeout)
   * defaults to March and posts a chat note.
   *
   * @param active - The non-defeated combatants to consider.
   * @returns A map of combatant id to resolved {@link Choice}.
   */
  async gatherPlayerChoices(active) {
    const players = active.filter((c) => c.tag === "player");
    const entries = await Promise.all(
      players.map(async (combatant) => {
        await this.port.markChoosing(combatant.id, true);
        const raw = await this.port.requestPlayerChoice(combatant.id);
        await this.port.markChoosing(combatant.id, false);
        if (raw === null) {
          await this.port.announceDefaultMarch(combatant.actorName);
          return [combatant.id, "march"];
        }
        return [combatant.id, normalizeChoice(raw)];
      })
    );
    return new Map(entries);
  }
  /**
   * Apply a single combatant's tag behavior: set a boss slot's fixed value, roll
   * a mob normally, or apply a player's effect and adjusted roll.
   *
   * @param combatant - The combatant to process.
   * @param choice - The player's resolved choice, if any (players only).
   */
  async applyCombatant(combatant, choice) {
    switch (combatant.tag) {
      case "boss": {
        if (combatant.bossSlot === null || combatant.bossRank === null) return;
        await this.port.setInitiative(combatant.id, bossSlotInitiative(combatant.bossSlot, combatant.bossRank));
        return;
      }
      case "mob": {
        const value = await this.port.rollInitiativeValue(combatant.id);
        await this.port.setInitiative(combatant.id, value);
        return;
      }
      case "player": {
        const resolved = choice ?? "march";
        await this.port.applyEffect(combatant.actorId, resolved);
        const base = await this.port.rollInitiativeValue(combatant.id);
        await this.port.setInitiative(combatant.id, base + initiativeAdjustment(resolved));
        return;
      }
    }
  }
};

// src/settings.ts
function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.PLAYER_TIMEOUT, {
    name: "TACTICAL_INITIATIVE.Settings.PlayerTimeout.Name",
    hint: "TACTICAL_INITIATIVE.Settings.PlayerTimeout.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 30,
    range: { min: 5, max: 300, step: 5 }
  });
}
function getPlayerTimeoutMs() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.PLAYER_TIMEOUT);
  const seconds = typeof raw === "number" && Number.isFinite(raw) ? raw : 30;
  return Math.max(5, seconds) * 1e3;
}

// src/logic/tag.ts
function isTag(value) {
  return typeof value === "string" && TAGS.includes(value);
}
function resolveTag(actorType, storedTag) {
  if (isTag(storedTag)) return storedTag;
  return actorType === "character" ? "player" : "mob";
}

// src/adapter/tags.ts
function readActorTag(actor) {
  if (!actor) return "mob";
  const stored = actor.getFlag(MODULE_ID, FLAGS.TAG);
  return resolveTag(actor.type, typeof stored === "string" ? stored : null);
}
function readCombatantTag(combatant) {
  return readActorTag(combatant.actor);
}
async function writeActorTag(actor, tag) {
  await actor.setFlag(MODULE_ID, FLAGS.TAG, tag);
}

// src/adapter/boss-slots.ts
function slotOf(combatant) {
  const value = combatant.getFlag(MODULE_ID, FLAGS.BOSS_SLOT);
  return value === "start" || value === "end" ? value : null;
}
function rankOf(combatant) {
  const value = combatant.getFlag(MODULE_ID, FLAGS.BOSS_ORDER);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function findEndSlot(combat, primaryId) {
  return combat.combatants.find((c) => c.getFlag(MODULE_ID, FLAGS.PRIMARY_ID) === primaryId);
}
function nextBossRank(combat) {
  const ranks = combat.combatants.contents.filter((c) => slotOf(c) === "start").map((c) => rankOf(c));
  return ranks.length > 0 ? Math.max(...ranks) + 1 : 0;
}
async function setupBossCombatant(combatant, combat) {
  if (readCombatantTag(combatant) !== "boss") return;
  if (slotOf(combatant) !== null) return;
  const rank = nextBossRank(combat);
  await combatant.update({
    initiative: bossSlotInitiative("start", rank),
    [`flags.${MODULE_ID}.${FLAGS.BOSS_SLOT}`]: "start",
    [`flags.${MODULE_ID}.${FLAGS.BOSS_ORDER}`]: rank
  });
  await combat.createEmbeddedDocuments("Combatant", [
    {
      tokenId: combatant.tokenId,
      actorId: combatant.actorId,
      sceneId: combatant.sceneId,
      initiative: bossSlotInitiative("end", rank),
      flags: {
        [MODULE_ID]: {
          [FLAGS.BOSS_SLOT]: "end",
          [FLAGS.PRIMARY_ID]: combatant.id,
          [FLAGS.BOSS_ORDER]: rank
        }
      }
    }
  ]);
}
async function cleanupBossPairOnDelete(deleted, combat) {
  const slot = slotOf(deleted);
  if (slot === "start") {
    const end = findEndSlot(combat, deleted.id);
    if (end) await end.delete();
    return;
  }
  if (slot === "end") {
    const primaryId = deleted.getFlag(MODULE_ID, FLAGS.PRIMARY_ID);
    const primary = typeof primaryId === "string" ? combat.combatants.get(primaryId) : void 0;
    if (primary) await primary.delete();
  }
}
async function syncBossDefeat(combatant, combat) {
  if (slotOf(combatant) !== "start") return;
  const end = findEndSlot(combat, combatant.id);
  if (end && end.isDefeated !== combatant.isDefeated) {
    await end.update({ defeated: combatant.isDefeated });
  }
}
async function reconcileBossOnRetag(combatant, combat) {
  const isBoss = readCombatantTag(combatant) === "boss";
  const slot = slotOf(combatant);
  if (isBoss && slot === null) {
    await setupBossCombatant(combatant, combat);
    return;
  }
  if (!isBoss && slot === "start") {
    const end = findEndSlot(combat, combatant.id);
    if (end) await end.delete();
    await combatant.update({
      [`flags.${MODULE_ID}.-=${FLAGS.BOSS_SLOT}`]: null,
      [`flags.${MODULE_ID}.-=${FLAGS.BOSS_ORDER}`]: null
    });
  }
}

// src/logic/effects.ts
function formatBonus(modifier) {
  return modifier < 0 ? String(modifier) : `+${modifier}`;
}
function effectChangesFor(choice) {
  const modifier = CHOICE_EFFECT_MODIFIER[choice];
  if (modifier === 0) return [];
  const value = formatBonus(modifier);
  return DND5E_BONUS_KEYS.map((key) => ({
    key,
    mode: ACTIVE_EFFECT_MODE_ADD,
    value,
    priority: 20
  }));
}
function toV14Changes(changes) {
  return changes.map(({ key, value, priority }) => ({
    key,
    type: ACTIVE_EFFECT_TYPE_ADD,
    value,
    priority
  }));
}

// src/adapter/player-query.ts
function toChoiceOrNull(value) {
  return typeof value === "string" && CHOICES.includes(value) ? value : null;
}
function isChoiceQueryData(data) {
  return typeof data.actorName === "string";
}
async function showChoiceDialog(data) {
  const actorName = isChoiceQueryData(data) ? data.actorName : "";
  const localize = (key) => game.i18n.localize(key);
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
function registerQueryHandler() {
  CONFIG.queries[QUERY_CHOOSE] = async (queryData) => {
    return showChoiceDialog(queryData);
  };
}
function pickOwningUser(combatant) {
  const owners = combatant.players.filter((user) => !user.isGM && user.active);
  return owners[0] ?? null;
}
async function requestChoiceFromOwner(combatant, timeoutMs) {
  const user = pickOwningUser(combatant);
  if (!user || !user.active) return null;
  const data = { actorName: combatant.actor?.name ?? "" };
  try {
    const result = await user.query(QUERY_CHOOSE, data, { timeout: timeoutMs });
    return toChoiceOrNull(result);
  } catch {
    return null;
  }
}

// src/adapter/foundry-adapter.ts
var EFFECT_ICON = {
  rush: "icons/svg/downgrade.svg",
  hunker: "icons/svg/upgrade.svg"
};
var FoundryAdapter = class {
  /**
   * @param combat - The combat this adapter operates on.
   * @param timeoutMs - Player-choice timeout in milliseconds.
   */
  constructor(combat, timeoutMs) {
    this.combat = combat;
    this.timeoutMs = timeoutMs;
  }
  /**
   * Resolve a combatant in this combat by id.
   *
   * @param combatantId - The combatant id.
   * @returns The combatant document.
   * @throws When no such combatant exists in this combat.
   */
  combatant(combatantId) {
    const found = this.combat.combatants.get(combatantId);
    if (!found) throw new Error(`${MODULE_ID}: combatant ${combatantId} not found`);
    return found;
  }
  /**
   * Resolve an actor by id via the world actors collection.
   *
   * @param actorId - The actor id.
   * @returns The actor, or `null` when not found.
   */
  actor(actorId) {
    return game.actors?.get(actorId) ?? null;
  }
  async listCombatants(_combatId) {
    return this.combat.combatants.contents.map((combatant) => {
      const slot = combatant.getFlag(MODULE_ID, FLAGS.BOSS_SLOT);
      const order = combatant.getFlag(MODULE_ID, FLAGS.BOSS_ORDER);
      const isBossSlot = slot === "start" || slot === "end";
      return {
        id: combatant.id,
        actorId: combatant.actorId ?? "",
        actorName: combatant.actor?.name ?? "",
        tag: readCombatantTag(combatant),
        isDefeated: combatant.isDefeated,
        bossSlot: isBossSlot ? slot : null,
        bossRank: isBossSlot && typeof order === "number" ? order : null
      };
    });
  }
  async clearInitiative(combatantId) {
    await this.combatant(combatantId).update({ initiative: null });
  }
  async removeTempEffects(actorId) {
    const actor = this.actor(actorId);
    if (!actor) return;
    const ids = actor.effects.filter((effect) => effect.getFlag(MODULE_ID, FLAGS.TEMP_EFFECT) === true).map((effect) => effect.id);
    if (ids.length > 0) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
  async applyEffect(actorId, choice) {
    const changes = effectChangesFor(choice);
    if (changes.length === 0) return;
    const actor = this.actor(actorId);
    if (!actor) return;
    const label = game.i18n.localize(`TACTICAL_INITIATIVE.Effect.${choice === "rush" ? "Rush" : "Hunker"}`);
    const base = {
      name: label,
      img: EFFECT_ICON[choice === "rush" ? "rush" : "hunker"],
      origin: actor.uuid,
      disabled: false,
      flags: { [MODULE_ID]: { [FLAGS.TEMP_EFFECT]: true } }
    };
    const data = (game.release?.generation ?? 0) >= V14_GENERATION ? { ...base, system: { changes: toV14Changes(changes) } } : { ...base, changes };
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  }
  async rollInitiativeValue(combatantId) {
    const combatant = this.combatant(combatantId);
    const roll = this.buildInitiativeRoll(combatant);
    await roll.evaluate();
    return roll.total;
  }
  /**
   * Build the combatant's initiative Roll using dnd5e's own builder so init
   * bonuses, the Alert feat, and situational modifiers are respected. Falls back
   * progressively if a builder is unavailable.
   *
   * @param combatant - The combatant to roll for.
   * @returns An unevaluated {@link FoundryRoll}.
   */
  buildInitiativeRoll(combatant) {
    if (typeof combatant.getInitiativeRoll === "function") return combatant.getInitiativeRoll();
    const actor = combatant.actor;
    if (actor && typeof actor.getInitiativeRoll === "function") return actor.getInitiativeRoll();
    const data = actor?.getRollData?.() ?? {};
    return new Roll("1d20 + @attributes.init.total", data);
  }
  async setInitiative(combatantId, value) {
    await this.combatant(combatantId).update({ initiative: value });
  }
  async requestPlayerChoice(combatantId) {
    return requestChoiceFromOwner(this.combatant(combatantId), this.timeoutMs);
  }
  async markChoosing(combatantId, choosing) {
    await this.combatant(combatantId).update({
      [`flags.${MODULE_ID}.${FLAGS.CHOOSING}`]: choosing
    });
  }
  async announceDefaultMarch(actorName) {
    const content = game.i18n.format("TACTICAL_INITIATIVE.Chat.DefaultedToMarch", { name: actorName });
    await ChatMessage.create({ content });
  }
};

// src/adapter/hooks.ts
function isActiveGM() {
  return game.user?.isGM === true && game.users?.activeGM === game.user;
}
function guard(label, body) {
  body().catch((error) => {
    console.error(`${MODULE_ID} | ${label}`, error);
  });
}
function serviceFor(combat) {
  return new TacticalInitiative(new FoundryAdapter(combat, getPlayerTimeoutMs()));
}
var lastRolledRound = /* @__PURE__ */ new Map();
async function rollRoundOnce(combat) {
  if (combat.round < 1) return;
  if (lastRolledRound.get(combat.id) === combat.round) return;
  lastRolledRound.set(combat.id, combat.round);
  await serviceFor(combat).rollForCombat(combat.id);
  await combat.update({ turn: 0 });
}
async function removeAllTempEffects(combat) {
  const seen = /* @__PURE__ */ new Set();
  for (const combatant of combat.combatants.contents) {
    const actor = combatant.actor;
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    const ids = actor.effects.filter((effect) => effect.getFlag(MODULE_ID, FLAGS.TEMP_EFFECT) === true).map((effect) => effect.id);
    if (ids.length > 0) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}
function registerHooks() {
  Hooks.on("combatStart", (combat) => {
    if (!isActiveGM()) return;
    guard("combatStart", () => rollRoundOnce(combat));
  });
  Hooks.on("combatRound", (combat) => {
    if (!isActiveGM()) return;
    guard("combatRound", () => rollRoundOnce(combat));
  });
  Hooks.on("createCombatant", (combatant) => {
    if (!isActiveGM()) return;
    const combat = combatant.combat;
    if (!combat) return;
    guard("createCombatant", async () => {
      const tag = readCombatantTag(combatant);
      if (tag === "boss") await setupBossCombatant(combatant, combat);
      if (combat.started && tag !== "boss") {
        await serviceFor(combat).rollForCombatant(combat.id, combatant.id);
      }
    });
  });
  Hooks.on("updateCombatant", (combatant, changes) => {
    if (!isActiveGM()) return;
    if (!("defeated" in changes)) return;
    const combat = combatant.combat;
    if (!combat) return;
    guard("updateCombatant", () => syncBossDefeat(combatant, combat));
  });
  Hooks.on("deleteCombatant", (combatant) => {
    if (!isActiveGM()) return;
    const combat = combatant.combat;
    if (!combat) return;
    guard("deleteCombatant", () => cleanupBossPairOnDelete(combatant, combat));
  });
  Hooks.on("deleteCombat", (combat) => {
    lastRolledRound.delete(combat.id);
    if (!isActiveGM()) return;
    guard("deleteCombat", () => removeAllTempEffects(combat));
  });
  registerChoosingIndicator();
}
function registerChoosingIndicator() {
  Hooks.on("renderCombatTracker", (app, html) => {
    try {
      const root = html instanceof HTMLElement ? html : html?.[0];
      if (!(root instanceof HTMLElement)) return;
      const combat = app.viewed ?? null;
      if (!combat) return;
      for (const combatant of combat.combatants.contents) {
        if (combatant.getFlag(MODULE_ID, FLAGS.CHOOSING) !== true) continue;
        const row = root.querySelector(`[data-combatant-id="${combatant.id}"]`);
        if (row) row.classList.add(`${MODULE_ID}-choosing`);
      }
    } catch {
    }
  });
}

// src/adapter/lookup.ts
function findCombatant(combatantId) {
  for (const combat of game.combats?.contents ?? []) {
    const combatant = combat.combatants.get(combatantId);
    if (combatant) return { combat, combatant };
  }
  return null;
}

// src/adapter/tagging-ui.ts
function combatantIdFromTarget(target) {
  const element = resolveElement(target);
  const id = element?.dataset["combatantId"];
  return typeof id === "string" ? id : null;
}
function resolveElement(value) {
  if (value instanceof HTMLElement) return value;
  const jqueryLike = value;
  const first = jqueryLike?.[0];
  return first instanceof HTMLElement ? first : null;
}
async function retagCombatant(combatantId, tag) {
  const location = findCombatant(combatantId);
  if (!location?.combatant.actor) return;
  await writeActorTag(location.combatant.actor, tag);
  await reconcileBossOnRetag(location.combatant, location.combat);
}
function pushTagOptions(options) {
  for (const tag of TAGS) {
    options.push({
      name: game.i18n.format("TACTICAL_INITIATIVE.Menu.TagAs", {
        tag: game.i18n.localize(`TACTICAL_INITIATIVE.Tag.${capitalize(tag)}`)
      }),
      icon: `<i class="fas fa-flag"></i>`,
      condition: () => game.user?.isGM === true,
      callback: (target) => {
        const id = combatantIdFromTarget(target);
        if (id) void retagCombatant(id, tag);
      }
    });
  }
}
function registerTrackerContextMenu() {
  const handler = (_appOrHtml, options) => {
    pushTagOptions(options);
  };
  Hooks.on("getCombatantContextOptions", handler);
  Hooks.on("getCombatTrackerEntryContext", handler);
}
function registerSheetTagControl() {
  const handler = (app, html) => {
    try {
      injectSheetControl(app, html);
    } catch {
    }
  };
  Hooks.on("renderActorSheet", handler);
  Hooks.on("renderActorSheetV2", handler);
}
function injectSheetControl(app, html) {
  if (game.user?.isGM !== true) return;
  const actor = app.actor ?? null;
  if (!actor) return;
  const root = resolveElement(html);
  const header = root?.querySelector(".window-header .window-title") ?? root?.querySelector(".window-header");
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
function capitalize(tag) {
  return `${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
}

// src/main.ts
Hooks.once("init", () => {
  registerSettings();
  registerQueryHandler();
  registerHooks();
  registerTrackerContextMenu();
  registerSheetTagControl();
  console.log(`${MODULE_ID} | initialized`);
});
//# sourceMappingURL=main.js.map
