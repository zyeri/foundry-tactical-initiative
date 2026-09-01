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
  TEMP_EFFECT: "temp",
  /** CombatantGroup flag: the tag color (a CSS hex string). */
  GROUP_COLOR: "color"
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
  PLAYER_TIMEOUT: "playerTimeoutSeconds",
  /** World setting: whether a boss death posts a public chat callout. */
  ANNOUNCE_BOSS_DEATH: "announceBossDeath",
  /** World setting: seconds a recorded damage source stays valid for kill attribution. */
  KILL_WINDOW: "killAttributionWindowSeconds",
  /** World setting: whether the top-bar tracker is shown. */
  ENABLE_TOP_BAR: "enableTopBar",
  /** World setting: how non-owned HP is shown to players ("bar" | "none"). */
  PLAYER_HP_POLICY: "playerHpPolicy"
};
var DEFAULT_KILL_WINDOW_SECONDS = 45;

// src/logic/death.ts
function crossedToZero(previousHp, newHp) {
  return previousHp > 0 && newHp <= 0;
}

// src/logic/hp.ts
function hpTransition(resultingHp, changes) {
  return { previousHp: resultingHp - changes.hp, newHp: resultingHp };
}

// src/logic/kill-message.ts
function killMessageKey(bossName, attribution) {
  if (!attribution) {
    return { key: "TACTICAL_INITIATIVE.Chat.BossDied", data: { boss: bossName } };
  }
  if (attribution.itemName === null) {
    return {
      key: "TACTICAL_INITIATIVE.Chat.BossKilledNoWeapon",
      data: { killer: attribution.attackerName, boss: bossName }
    };
  }
  return {
    key: "TACTICAL_INITIATIVE.Chat.BossKilled",
    data: { killer: attribution.attackerName, boss: bossName, weapon: attribution.itemName }
  };
}

// src/logic/kill-source.ts
function parseDamageCard(card, now, resolveItemName2) {
  const dnd5e = card.flags?.dnd5e;
  if (!dnd5e || dnd5e.roll?.type !== "damage") return null;
  const targetUuids = (dnd5e.targets ?? []).map((target) => target.uuid ?? target.actor).filter((uuid) => typeof uuid === "string");
  if (targetUuids.length === 0) return null;
  const speaker = card.speaker ?? {};
  const itemUuid = dnd5e.item?.uuid;
  return {
    attackerName: speaker.alias ?? "",
    attackerActorId: speaker.actor ?? "",
    itemName: itemUuid ? resolveItemName2(itemUuid) : null,
    targetUuids,
    timestamp: now
  };
}
function isSelfHit(attackerActorId, targetUuids) {
  if (attackerActorId === "") return false;
  const marker = "Actor.";
  return targetUuids.some((uuid) => {
    const at = uuid.lastIndexOf(marker);
    const targetActorId = at >= 0 ? uuid.slice(at + marker.length) : uuid;
    return targetActorId === attackerActorId;
  });
}
function nextSource(prev, event) {
  if (event.attackerName === "") return prev;
  if (event.targetUuids.length === 0) return prev;
  if (isSelfHit(event.attackerActorId, event.targetUuids)) return prev;
  return { ...event };
}
function selectAttribution(source, deadActorUuid, now, windowMs) {
  if (!source) return null;
  if (!source.targetUuids.includes(deadActorUuid)) return null;
  if (now - source.timestamp > windowMs) return null;
  return { attackerName: source.attackerName, itemName: source.itemName };
}

// src/death-service.ts
var DeathService = class {
  /**
   * @param port - The Foundry seam.
   */
  constructor(port) {
    this.port = port;
  }
  /** The last real damage source seen this session. */
  lastSource = null;
  /**
   * Fold a parsed damage event into the recorded source (a `null` event is a no-op).
   *
   * @param event - The parsed damage event, or `null`.
   */
  recordDamage(event) {
    if (event === null) return;
    this.lastSource = nextSource(this.lastSource, event);
  }
  /** The current recorded damage source (for later consumers). */
  getLastSource() {
    return this.lastSource;
  }
  /**
   * React to an actor's HP change: if it just crossed to 0, run the mob and boss
   * rules that apply.
   *
   * @param actor - The damaged actor handle.
   * @param changes - The signed-delta payload from `dnd5e.damageActor`.
   */
  async handleDamage(actor, changes) {
    const resultingHp = this.port.actorHp(actor);
    if (resultingHp === null) return;
    if (resultingHp > 0) return;
    const { previousHp, newHp } = hpTransition(resultingHp, changes);
    if (!crossedToZero(previousHp, newHp)) return;
    if (this.port.isExplicitMob(actor)) await this.handleMob(actor);
    if (this.port.isBoss(actor)) await this.handleBoss(actor);
  }
  /**
   * Restore a removed mob to its origin combat and un-hide its token.
   *
   * @param tokenUuid - The removed token's UUID.
   * @param combatId - The combat the mob was removed from.
   */
  async restoreMob(tokenUuid, combatId) {
    const token = this.port.resolveToken(tokenUuid);
    if (!token) return;
    await this.port.unhideToken(token);
    if (!this.port.combatExists(combatId)) {
      this.port.warnRestoreNoCombat();
      return;
    }
    if (!this.port.combatHasToken(combatId, token)) {
      await this.port.addTokenToCombat(combatId, token);
    }
  }
  /**
   * F4: remove an explicitly-tagged mob from combat and hide the token(s) that died.
   *
   * @param actor - The dead actor handle.
   */
  async handleMob(actor) {
    for (const token of this.port.tokensForActor(actor)) {
      const location = this.port.findCombatantForToken(token.id);
      if (!location) continue;
      await this.port.hideToken(token);
      await this.port.removeCombatant(location);
      await this.port.whisperRestore(token, location.combatId);
    }
  }
  /**
   * F5: post a public, best-effort attributed boss-death callout.
   *
   * @param actor - The dead actor handle.
   */
  async handleBoss(actor) {
    if (!this.port.announceBossDeath()) return;
    const attribution = selectAttribution(
      this.lastSource,
      this.port.actorUuid(actor),
      this.port.now(),
      this.port.killWindowMs()
    );
    const { key, data } = killMessageKey(this.port.actorName(actor), attribution);
    await this.port.postPublic(this.port.localize(key, data));
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
  game.settings.register(MODULE_ID, SETTINGS.ANNOUNCE_BOSS_DEATH, {
    name: "TACTICAL_INITIATIVE.Settings.AnnounceBossDeath.Name",
    hint: "TACTICAL_INITIATIVE.Settings.AnnounceBossDeath.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.KILL_WINDOW, {
    name: "TACTICAL_INITIATIVE.Settings.KillAttributionWindow.Name",
    hint: "TACTICAL_INITIATIVE.Settings.KillAttributionWindow.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_KILL_WINDOW_SECONDS,
    range: { min: 5, max: 300, step: 5 }
  });
  game.settings.register(MODULE_ID, SETTINGS.ENABLE_TOP_BAR, {
    name: "TACTICAL_INITIATIVE.Settings.EnableTopBar.Name",
    hint: "TACTICAL_INITIATIVE.Settings.EnableTopBar.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.PLAYER_HP_POLICY, {
    name: "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Name",
    hint: "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      bar: "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.Bar",
      none: "TACTICAL_INITIATIVE.Settings.PlayerHpPolicy.None"
    },
    default: "bar"
  });
}
function getPlayerTimeoutMs() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.PLAYER_TIMEOUT);
  const seconds = typeof raw === "number" && Number.isFinite(raw) ? raw : 30;
  return Math.max(5, seconds) * 1e3;
}
function getAnnounceBossDeath() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.ANNOUNCE_BOSS_DEATH);
  return raw !== false;
}
function getKillWindowMs() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.KILL_WINDOW);
  const seconds = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_KILL_WINDOW_SECONDS;
  return Math.max(5, seconds) * 1e3;
}

// src/logic/boss.ts
function bossSlotInitiative(slot, rank) {
  const base = slot === "start" ? BOSS_START_BASE : BOSS_END_BASE;
  return base - rank;
}

// src/logic/group.ts
function partitionByGroup(combatants) {
  const ungrouped = [];
  const groups = [];
  const byId = /* @__PURE__ */ new Map();
  for (const combatant of combatants) {
    if (combatant.groupId === null) {
      ungrouped.push(combatant);
      continue;
    }
    let group = byId.get(combatant.groupId);
    if (!group) {
      group = { groupId: combatant.groupId, members: [] };
      byId.set(combatant.groupId, group);
      groups.push(group);
    }
    group.members.push(combatant);
  }
  return { groups, ungrouped };
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
    const { groups, ungrouped } = partitionByGroup(active);
    const choices = await this.gatherPlayerChoices(ungrouped);
    for (const combatant of ungrouped) {
      await this.applyCombatant(combatant, choices.get(combatant.id));
    }
    for (const group of groups) {
      const value = await this.port.rollGroupInitiative(group.groupId);
      for (const member of group.members) {
        await this.port.setInitiative(member.id, value);
      }
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
    if (combatant.groupId !== null) {
      const shared = await this.port.groupInitiativeValue(combatant.groupId);
      if (shared !== null) await this.port.setInitiative(combatant.id, shared);
      return;
    }
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

// src/logic/tag.ts
function isTag(value) {
  return typeof value === "string" && TAGS.includes(value);
}
function resolveTag(actorType, storedTag) {
  if (isTag(storedTag)) return storedTag;
  return actorType === "character" ? "player" : "mob";
}

// src/adapter/tags.ts
function isExplicitlyTagged(actor, tag) {
  return actor.getFlag(MODULE_ID, FLAGS.TAG) === tag;
}
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
  if (typeof combatant.group === "string" && combatant.group) return;
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
async function tearDownBossSlots(combatant, combat) {
  if (slotOf(combatant) !== "start") return;
  const end = findEndSlot(combat, combatant.id);
  await combatant.update({
    [`flags.${MODULE_ID}.-=${FLAGS.BOSS_SLOT}`]: null,
    [`flags.${MODULE_ID}.-=${FLAGS.BOSS_ORDER}`]: null
  });
  if (end) {
    await end.update({ [`flags.${MODULE_ID}.-=${FLAGS.BOSS_SLOT}`]: null });
    await end.delete();
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
        bossRank: isBossSlot && typeof order === "number" ? order : null,
        groupId: typeof combatant.group === "string" && combatant.group ? combatant.group : null
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
  async rollGroupInitiative(groupId) {
    const member = this.combat.combatants.find(
      (c) => (typeof c.group === "string" ? c.group : null) === groupId
    );
    if (!member) return 0;
    const roll = this.buildInitiativeRoll(member);
    await roll.evaluate();
    return roll.total;
  }
  async groupInitiativeValue(groupId) {
    const group = this.combat.groups.get(groupId);
    return group && typeof group.initiative === "number" ? group.initiative : null;
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
      const grouped = typeof combatant.group === "string" && combatant.group.length > 0;
      if (tag === "boss" && !grouped) await setupBossCombatant(combatant, combat);
      if (combat.started && (grouped || tag !== "boss")) {
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

// src/adapter/combat-events.ts
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function tokenDoc(uuid) {
  return fromUuidSync(uuid);
}
var FoundryDeathPort = class {
  now() {
    return Date.now();
  }
  actorHp(actor) {
    const hp = actor.system?.attributes?.hp?.value;
    return typeof hp === "number" ? hp : null;
  }
  actorUuid(actor) {
    return actor.uuid;
  }
  actorName(actor) {
    return actor.name;
  }
  isExplicitMob(actor) {
    return isExplicitlyTagged(actor, "mob");
  }
  isBoss(actor) {
    return readActorTag(actor) === "boss";
  }
  tokensForActor(actor) {
    const a = actor;
    const tokens = a.isToken && a.token ? [a.token] : a.getActiveTokens(false, true);
    return tokens.map((token) => ({ id: token.id, uuid: token.uuid, name: token.name }));
  }
  findCombatantForToken(tokenId) {
    for (const combat of game.combats?.contents ?? []) {
      const combatant = combat.combatants.find((entry) => entry.tokenId === tokenId);
      if (combatant) return { combatId: combat.id, combatantId: combatant.id };
    }
    return null;
  }
  async hideToken(token) {
    await tokenDoc(token.uuid)?.update({ hidden: true });
  }
  async removeCombatant(location) {
    const combatant = game.combats?.get(location.combatId)?.combatants.get(location.combatantId);
    if (combatant) await combatant.delete();
  }
  async whisperRestore(token, combatId) {
    const gmId = game.user?.id;
    if (!gmId) return;
    const label = escapeHtml(
      game.i18n.format("TACTICAL_INITIATIVE.Chat.RestoreMob", { name: token.name })
    );
    const content = `<button type="button" data-ti-token="${escapeHtml(token.uuid)}" data-ti-combat="${escapeHtml(combatId)}">${label}</button>`;
    await ChatMessage.create({ content, whisper: [gmId] });
  }
  announceBossDeath() {
    return getAnnounceBossDeath();
  }
  killWindowMs() {
    return getKillWindowMs();
  }
  async postPublic(content) {
    await ChatMessage.create({ content });
  }
  localize(key, data) {
    return game.i18n.format(key, data);
  }
  resolveToken(tokenUuid) {
    const token = tokenDoc(tokenUuid);
    return token ? { id: token.id, uuid: token.uuid, name: token.name } : null;
  }
  async unhideToken(token) {
    await tokenDoc(token.uuid)?.update({ hidden: false });
  }
  combatExists(combatId) {
    return game.combats?.get(combatId) != null;
  }
  combatHasToken(combatId, token) {
    const combat = game.combats?.get(combatId);
    return combat?.combatants.find((entry) => entry.tokenId === token.id) != null;
  }
  async addTokenToCombat(combatId, token) {
    const combat = game.combats?.get(combatId);
    const doc = tokenDoc(token.uuid);
    if (!combat || !doc) return;
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: doc.id, sceneId: doc.parent?.id, actorId: doc.actorId }
    ]);
  }
  warnRestoreNoCombat() {
    ui.notifications?.warn(game.i18n.localize("TACTICAL_INITIATIVE.Chat.RestoreNoCombat"));
  }
};
function resolveItemName(itemUuid) {
  return fromUuidSync(itemUuid)?.name ?? null;
}
function registerCombatEvents() {
  const service = new DeathService(new FoundryDeathPort());
  Hooks.on("createChatMessage", (message) => {
    if (!isActiveGM()) return;
    try {
      service.recordDamage(parseDamageCard(message, Date.now(), resolveItemName));
    } catch (error) {
      console.error(`${MODULE_ID} | recordDamage`, error);
    }
  });
  Hooks.on("dnd5e.damageActor", (actor, changes) => {
    if (!isActiveGM()) return;
    guard(
      "damageActor",
      () => service.handleDamage(actor, changes)
    );
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest("[data-ti-token]");
    const tokenUuid = button?.dataset["tiToken"];
    const combatId = button?.dataset["tiCombat"];
    if (!button || !tokenUuid || !combatId) return;
    button.removeAttribute("data-ti-token");
    guard("restoreMob", () => service.restoreMob(tokenUuid, combatId));
  });
}

// src/adapter/groups.ts
var DEFAULT_GROUP_COLOR = "#8888ff";
async function addToGroup(combat, combatantIds, groupId) {
  if (combatantIds.length === 0) return;
  let targetId = groupId;
  if (targetId === null) {
    const name = game.i18n.format("TACTICAL_INITIATIVE.Group.DefaultName", {
      n: String(combat.groups.size + 1)
    });
    const created = await combat.createEmbeddedDocuments("CombatantGroup", [
      { name, flags: { [MODULE_ID]: { [FLAGS.GROUP_COLOR]: DEFAULT_GROUP_COLOR } } }
    ]);
    const group = created[0];
    if (!group) return;
    targetId = group.id;
  }
  await combat.updateEmbeddedDocuments(
    "Combatant",
    combatantIds.map((id) => ({ _id: id, group: targetId }))
  );
  for (const id of combatantIds) {
    const combatant = combat.combatants.get(id);
    if (combatant) await tearDownBossSlots(combatant, combat);
  }
}
async function removeFromGroup(combat, combatantIds) {
  const affected = /* @__PURE__ */ new Set();
  for (const id of combatantIds) {
    const combatant = combat.combatants.get(id);
    const group = combatant && typeof combatant.group === "string" ? combatant.group : null;
    if (group) affected.add(group);
  }
  await combat.updateEmbeddedDocuments(
    "Combatant",
    combatantIds.map((id) => ({ _id: id, group: null }))
  );
  for (const groupId of affected) {
    const stillHasMembers = combat.combatants.contents.some(
      (c) => (typeof c.group === "string" ? c.group : null) === groupId
    );
    if (!stillHasMembers) await disbandGroup(combat, groupId);
  }
}
async function renameGroup(combat, groupId, name) {
  await combat.groups.get(groupId)?.update({ name });
}
async function recolorGroup(combat, groupId, color) {
  await combat.groups.get(groupId)?.setFlag(MODULE_ID, FLAGS.GROUP_COLOR, color);
}
async function disbandGroup(combat, groupId) {
  const memberIds = combat.combatants.contents.filter((c) => (typeof c.group === "string" ? c.group : null) === groupId).map((c) => c.id);
  if (memberIds.length > 0) {
    await combat.updateEmbeddedDocuments(
      "Combatant",
      memberIds.map((id) => ({ _id: id, group: null }))
    );
  }
  await combat.deleteEmbeddedDocuments("CombatantGroup", [groupId]);
}
function groupColor(group) {
  const color = group.getFlag(MODULE_ID, FLAGS.GROUP_COLOR);
  return typeof color === "string" ? color : DEFAULT_GROUP_COLOR;
}

// src/group-control-service.ts
var GroupControlService = class {
  /**
   * @param port - The Foundry seam.
   */
  constructor(port) {
    this.port = port;
  }
  /**
   * Select every member token on the canvas (members without a token are skipped).
   *
   * @param groupId - The group id.
   */
  async selectAll(groupId) {
    await this.port.selectTokens(this.tokenIds(groupId));
  }
  /**
   * Target every member token.
   *
   * @param groupId - The group id.
   */
  async targetAll(groupId) {
    await this.port.targetTokens(this.tokenIds(groupId));
  }
  /**
   * Apply damage or healing to every member actor.
   *
   * @param groupId - The group id.
   * @param input - The damage/healing to apply.
   */
  async applyToAll(groupId, input) {
    for (const member of this.port.members(groupId)) {
      await this.port.applyDamage(member.actorId, input);
    }
  }
  /**
   * Toggle a condition on every member.
   *
   * @param groupId - The group id.
   * @param statusId - The dnd5e status/condition id.
   * @param active - Whether to add (`true`) or remove (`false`) it.
   */
  async setConditionAll(groupId, statusId, active) {
    for (const member of this.port.members(groupId)) {
      await this.port.setCondition(member, statusId, active);
    }
  }
  /** Token ids of members that have a token. */
  tokenIds(groupId) {
    return this.port.members(groupId).map((member) => member.tokenId).filter((id) => id !== null);
  }
};

// src/adapter/group-control.ts
var FoundryGroupControlPort = class {
  /**
   * @param combat - The combat whose groups this port operates on.
   */
  constructor(combat) {
    this.combat = combat;
  }
  /**
   * The current members of a group, as {@link GroupMemberRef}s.
   *
   * @param groupId - The group id.
   * @returns The member refs (empty for an unknown or empty group).
   */
  members(groupId) {
    return this.combat.combatants.contents.filter((combatant) => (typeof combatant.group === "string" ? combatant.group : null) === groupId).map((combatant) => ({
      combatantId: combatant.id,
      tokenId: combatant.tokenId,
      actorId: combatant.actorId ?? "",
      name: combatant.actor?.name ?? ""
    }));
  }
  /**
   * Control (select) the given tokens on the canvas, replacing the prior
   * selection with the first and adding the rest.
   *
   * @param tokenIds - The token ids to select.
   */
  async selectTokens(tokenIds) {
    if (!isActiveGM()) return;
    let releaseOthers = true;
    for (const id of tokenIds) {
      canvas.tokens?.get(id)?.control({ releaseOthers });
      releaseOthers = false;
    }
  }
  /**
   * Add the given tokens to the user's targets (existing targets are kept).
   *
   * @param tokenIds - The token ids to target.
   */
  async targetTokens(tokenIds) {
    if (!isActiveGM()) return;
    for (const id of tokenIds) {
      canvas.tokens?.get(id)?.setTarget(true, { releaseOthers: false });
    }
  }
  /**
   * Apply damage (or healing when `isHealing`) to an actor via dnd5e
   * `applyDamage`, which respects resistances and immunities.
   *
   * @param actorId - The actor id.
   * @param input - The amount and direction.
   */
  async applyDamage(actorId, input) {
    if (!isActiveGM()) return;
    const actor = game.actors?.get(actorId);
    if (!actor?.applyDamage) return;
    await actor.applyDamage(input.amount, { multiplier: input.isHealing === true ? -1 : 1 });
  }
  /**
   * Toggle a status/condition on a member's actor.
   *
   * @param member - The member.
   * @param statusId - The dnd5e status/condition id.
   * @param active - Whether to add (`true`) or remove (`false`) it.
   */
  async setCondition(member, statusId, active) {
    if (!isActiveGM()) return;
    const actor = game.actors?.get(member.actorId);
    if (!actor?.toggleStatusEffect) return;
    await actor.toggleStatusEffect(statusId, { active });
  }
};

// src/adapter/group-hud.ts
function openGroupHud(combat, groupId) {
  void new GroupHud(combat, groupId).render(true);
}
var GroupHud = class extends foundry.applications.api.ApplicationV2 {
  /**
   * @param combat - The combat that owns the group.
   * @param groupId - The group id this HUD controls.
   */
  constructor(combat, groupId) {
    super({ id: `${MODULE_ID}-group-hud-${groupId}` });
    this.groupId = groupId;
    this.port = new FoundryGroupControlPort(combat);
    this.service = new GroupControlService(this.port);
  }
  service;
  port;
  static DEFAULT_OPTIONS = {
    classes: [`${MODULE_ID}-group-hud`],
    window: { title: "TACTICAL_INITIATIVE.HUD.Title", resizable: true },
    position: { width: 320 }
  };
  /** Build the panel content: a member list plus the action bar. */
  async _renderHTML(_context, _options) {
    const root = document.createElement("div");
    root.className = `${MODULE_ID}-group-hud-body`;
    const list = document.createElement("ul");
    list.className = `${MODULE_ID}-group-hud-members`;
    for (const member of this.port.members(this.groupId)) {
      list.appendChild(this.renderMember(member));
    }
    root.append(list, this.renderActions());
    return root;
  }
  /** Mount the built content and wire the action buttons. */
  _replaceHTML(result, content, _options) {
    if (!(result instanceof HTMLElement)) return;
    content.replaceChildren(result);
    this.wireActions(content);
  }
  /** One member row: name + HP. */
  renderMember(member) {
    const li = document.createElement("li");
    li.className = `${MODULE_ID}-group-hud-member`;
    const hp = game.actors?.get(member.actorId)?.system?.attributes?.hp;
    const value = typeof hp?.value === "number" ? hp.value : null;
    const max = typeof hp?.max === "number" ? hp.max : null;
    const name = document.createElement("span");
    name.className = `${MODULE_ID}-group-hud-name`;
    name.textContent = member.name;
    const hpEl = document.createElement("span");
    hpEl.className = `${MODULE_ID}-group-hud-hp`;
    hpEl.textContent = value === null ? "" : max === null ? String(value) : `${value} / ${max}`;
    li.append(name, hpEl);
    return li;
  }
  /** The four action buttons. */
  renderActions() {
    const bar = document.createElement("div");
    bar.className = `${MODULE_ID}-group-hud-actions`;
    const buttons = [
      ["select", "TACTICAL_INITIATIVE.HUD.SelectAll"],
      ["target", "TACTICAL_INITIATIVE.HUD.TargetAll"],
      ["damage", "TACTICAL_INITIATIVE.HUD.ApplyDamage"],
      ["condition", "TACTICAL_INITIATIVE.HUD.Condition"]
    ];
    for (const [action, key] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset["tiAction"] = action;
      button.textContent = game.i18n.localize(key);
      bar.appendChild(button);
    }
    return bar;
  }
  /** Attach click handlers to the action buttons. */
  wireActions(content) {
    const bind = (action, handler) => {
      const button = content.querySelector(`button[data-ti-action='${action}']`);
      button?.addEventListener("click", () => void handler());
    };
    bind("select", () => this.service.selectAll(this.groupId));
    bind("target", () => this.service.targetAll(this.groupId));
    bind("damage", () => this.promptDamage());
    bind("condition", () => this.promptCondition());
  }
  /** Prompt for an amount + heal flag, then apply to every member. */
  async promptDamage() {
    const raw = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("TACTICAL_INITIATIVE.HUD.ApplyDamage") },
      modal: true,
      content: `<input type="number" name="value" value="0" min="0" style="width:100%" autofocus><label style="display:block;margin-top:0.3em"><input type="checkbox" name="heal"> ${game.i18n.localize("TACTICAL_INITIATIVE.HUD.Heal")}</label>`,
      ok: {
        action: "ok",
        callback: (_event, button) => {
          const amount2 = button.form?.elements.namedItem("value");
          const heal = button.form?.elements.namedItem("heal");
          const value = amount2 instanceof HTMLInputElement ? amount2.value : "0";
          const isHeal = heal instanceof HTMLInputElement && heal.checked;
          return `${isHeal ? "-" : ""}${value}`;
        }
      }
    });
    if (typeof raw !== "string") return;
    const amount = Math.abs(Number.parseInt(raw, 10));
    if (!Number.isFinite(amount) || amount <= 0) return;
    await this.service.applyToAll(this.groupId, { amount, isHealing: raw.startsWith("-") });
  }
  /** Prompt for a status id, then toggle it on every member. */
  async promptCondition() {
    const statusId = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("TACTICAL_INITIATIVE.HUD.Condition") },
      modal: true,
      content: `<input type="text" name="value" placeholder="prone" style="width:100%" autofocus>`,
      ok: {
        action: "ok",
        callback: (_event, button) => {
          const field = button.form?.elements.namedItem("value");
          return field instanceof HTMLInputElement ? field.value.trim() : "";
        }
      }
    });
    if (typeof statusId !== "string" || statusId.length === 0) return;
    await this.service.setConditionAll(this.groupId, statusId, true);
  }
};

// src/adapter/lookup.ts
function findCombatant(combatantId) {
  for (const combat of game.combats?.contents ?? []) {
    const combatant = combat.combatants.get(combatantId);
    if (combatant) return { combat, combatant };
  }
  return null;
}

// src/adapter/group-ui.ts
function resolveElement(value) {
  if (value instanceof HTMLElement) return value;
  const jqueryLike = value;
  const first = jqueryLike?.[0];
  return first instanceof HTMLElement ? first : null;
}
function combatantIdFromTarget(target) {
  const element = resolveElement(target);
  const id = element?.dataset["combatantId"];
  return typeof id === "string" ? id : null;
}
function selectedCombatantIds(target) {
  const ids = /* @__PURE__ */ new Set();
  const clicked = combatantIdFromTarget(target);
  if (clicked) ids.add(clicked);
  try {
    const element = resolveElement(target);
    const tracker = element?.closest("#combat, .combat-tracker, section.combat, [data-tab='combat']") ?? element?.ownerDocument.body ?? null;
    const selected = tracker?.querySelectorAll(
      ".combatant.selected, li.combatant[aria-selected='true'], .combatant.active-selection"
    );
    selected?.forEach((row) => {
      const id = row.dataset["combatantId"];
      if (typeof id === "string" && id.length > 0) ids.add(id);
    });
  } catch {
  }
  return [...ids];
}
function clickedGroupId(target) {
  const id = combatantIdFromTarget(target);
  if (!id) return null;
  const location = findCombatant(id);
  const group = location && typeof location.combatant.group === "string" ? location.combatant.group : null;
  return group && group.length > 0 ? group : null;
}
function isGrouped(target) {
  return clickedGroupId(target) !== null;
}
function openHudForClicked(target) {
  const id = combatantIdFromTarget(target);
  const groupId = clickedGroupId(target);
  if (!id || !groupId) return;
  const location = findCombatant(id);
  if (!location) return;
  openGroupHud(location.combat, groupId);
}
function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function readDialogValue(button) {
  const field = button.form?.elements.namedItem("value");
  return field instanceof HTMLInputElement ? field.value : "";
}
async function promptForText(titleKey, current) {
  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(titleKey) },
      modal: true,
      content: `<input type="text" name="value" value="${escapeAttribute(current)}" style="width:100%" autofocus>`,
      ok: {
        action: "ok",
        callback: (_event, button) => readDialogValue(button).trim()
      }
    });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}
async function promptForColor(current) {
  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("TACTICAL_INITIATIVE.Group.Recolor") },
      modal: true,
      content: `<input type="color" name="value" value="${escapeAttribute(current)}" autofocus>`,
      ok: {
        action: "ok",
        callback: (_event, button) => readDialogValue(button)
      }
    });
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}
async function addSelectionToNewGroup(target) {
  const id = combatantIdFromTarget(target);
  if (!id) return;
  const location = findCombatant(id);
  if (!location) return;
  await addToGroup(location.combat, selectedCombatantIds(target), null);
}
async function removeClickedFromGroup(target) {
  const id = combatantIdFromTarget(target);
  if (!id) return;
  const location = findCombatant(id);
  if (!location) return;
  await removeFromGroup(location.combat, [id]);
}
async function renameClickedGroup(target) {
  const id = combatantIdFromTarget(target);
  const groupId = clickedGroupId(target);
  if (!id || !groupId) return;
  const location = findCombatant(id);
  if (!location) return;
  const current = location.combat.groups.get(groupId)?.name ?? "";
  const name = await promptForText("TACTICAL_INITIATIVE.Group.Rename", current);
  if (name !== null && name.length > 0) await renameGroup(location.combat, groupId, name);
}
async function recolorClickedGroup(target) {
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
async function disbandClickedGroup(target) {
  const id = combatantIdFromTarget(target);
  const groupId = clickedGroupId(target);
  if (!id || !groupId) return;
  const location = findCombatant(id);
  if (!location) return;
  await disbandGroup(location.combat, groupId);
}
function pushGroupOptions(options) {
  const isGM = () => game.user?.isGM === true;
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.AddTo"),
    icon: `<i class="fas fa-object-group"></i>`,
    condition: () => isGM(),
    callback: (target) => {
      void addSelectionToNewGroup(target);
    }
  });
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.HUD.Open"),
    icon: `<i class="fas fa-gauge-high"></i>`,
    condition: (target) => isGM() && isGrouped(target),
    callback: (target) => {
      openHudForClicked(target);
    }
  });
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.Remove"),
    icon: `<i class="fas fa-object-ungroup"></i>`,
    condition: (target) => isGM() && isGrouped(target),
    callback: (target) => {
      void removeClickedFromGroup(target);
    }
  });
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.Rename"),
    icon: `<i class="fas fa-pen"></i>`,
    condition: (target) => isGM() && isGrouped(target),
    callback: (target) => {
      void renameClickedGroup(target);
    }
  });
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.Recolor"),
    icon: `<i class="fas fa-palette"></i>`,
    condition: (target) => isGM() && isGrouped(target),
    callback: (target) => {
      void recolorClickedGroup(target);
    }
  });
  options.push({
    name: game.i18n.localize("TACTICAL_INITIATIVE.Group.Disband"),
    icon: `<i class="fas fa-users-slash"></i>`,
    condition: (target) => isGM() && isGrouped(target),
    callback: (target) => {
      void disbandClickedGroup(target);
    }
  });
}
var GROUP_CONTEXT_PATCHED = "__tacticalInitiativeGroupContextPatched";
var ENTRY_CONTEXT_METHOD = "_getEntryContextOptions";
function trackerPrototype() {
  const config = CONFIG;
  const fromClass = config.ui?.combat?.prototype;
  if (fromClass && typeof fromClass === "object") return fromClass;
  const directory = game.combats?.directory;
  return directory ? Object.getPrototypeOf(directory) : null;
}
function tryPatchTracker() {
  try {
    const proto = trackerPrototype();
    if (!proto) return false;
    if (proto[GROUP_CONTEXT_PATCHED] === true) return true;
    const original = proto[ENTRY_CONTEXT_METHOD];
    if (typeof original !== "function") return false;
    const wrapped = original;
    proto[ENTRY_CONTEXT_METHOD] = function(...args) {
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
function decorateTrackerGroups(root) {
  try {
    const combat = game.combats?.active ?? null;
    if (!combat) return;
    const rows = root.querySelectorAll(".combatant[data-combatant-id]");
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
      const anchor = row.querySelector(".token-name, .combatant-name, .name") ?? row;
      anchor.appendChild(tag);
    });
  } catch {
  }
}
function registerGroupUI() {
  Hooks.once("ready", () => {
    if (tryPatchTracker()) return;
    Hooks.on("getCombatantContextOptions", (_appOrHtml, options) => {
      pushGroupOptions(options);
    });
  });
  Hooks.on("renderCombatTracker", (_app, html) => {
    const root = resolveElement(html);
    if (root) decorateTrackerGroups(root);
  });
}

// src/logic/tracker-view.ts
var DEFAULT_GROUP_COLOR2 = "#8888ff";
function isVisible(combatant, viewer2) {
  return viewer2.isGM || !combatant.hidden || combatant.ownedByViewer;
}
function hpFor(combatant, viewer2) {
  if (viewer2.isGM || combatant.ownedByViewer) {
    return { value: combatant.hp.value, max: combatant.hp.max, shown: "full" };
  }
  if (viewer2.playerHpPolicy === "bar") {
    return { value: combatant.hp.value, max: combatant.hp.max, shown: "bar" };
  }
  return { value: null, max: null, shown: "none" };
}
function buildTrackerView(input, viewer2) {
  const meta = new Map(input.groups.map((group) => [group.id, group]));
  const rows = [];
  const seenGroups = /* @__PURE__ */ new Set();
  for (const combatant of input.combatants) {
    if (!isVisible(combatant, viewer2)) continue;
    if (combatant.groupId !== null) {
      if (seenGroups.has(combatant.groupId)) continue;
      seenGroups.add(combatant.groupId);
      const members = input.combatants.filter(
        (other) => other.groupId === combatant.groupId && isVisible(other, viewer2)
      );
      const group = meta.get(combatant.groupId);
      rows.push({
        kind: "group",
        groupId: combatant.groupId,
        name: group?.name ?? "",
        color: group?.color ?? DEFAULT_GROUP_COLOR2,
        memberCount: members.length,
        initiative: combatant.initiative,
        img: members[0]?.img ?? null,
        isCurrent: members.some((member) => member.id === input.currentId)
      });
    } else {
      rows.push({
        kind: "combatant",
        combatantId: combatant.id,
        name: combatant.name,
        img: combatant.img,
        initiative: combatant.initiative,
        tag: combatant.tag,
        hp: hpFor(combatant, viewer2),
        conditions: combatant.conditions,
        isCurrent: combatant.id === input.currentId,
        isDefeated: combatant.isDefeated
      });
    }
  }
  return rows;
}

// src/adapter/tagging-ui.ts
function combatantIdFromTarget2(target) {
  const element = resolveElement2(target);
  const id = element?.dataset["combatantId"];
  return typeof id === "string" ? id : null;
}
function resolveElement2(value) {
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
        const id = combatantIdFromTarget2(target);
        if (id) void retagCombatant(id, tag);
      }
    });
  }
}
function actorIdFromTarget(target) {
  const element = resolveElement2(target);
  if (!element) return null;
  const direct = element.dataset["entryId"] ?? element.dataset["documentId"];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const ancestor = element.closest("[data-entry-id]");
  const id = ancestor?.dataset["entryId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}
async function retagActor(actorId, tag) {
  const actor = game.actors?.get(actorId) ?? null;
  if (!actor) return;
  await writeActorTag(actor, tag);
  for (const combat of game.combats?.contents ?? []) {
    const combatant = combat.combatants.contents.find((c) => c.actorId === actorId);
    if (combatant) await reconcileBossOnRetag(combatant, combat);
  }
}
function pushActorTagOptions(options) {
  for (const tag of TAGS) {
    options.push({
      name: game.i18n.format("TACTICAL_INITIATIVE.Menu.TagAs", {
        tag: game.i18n.localize(`TACTICAL_INITIATIVE.Tag.${capitalize(tag)}`)
      }),
      icon: `<i class="fas fa-flag"></i>`,
      condition: () => game.user?.isGM === true,
      callback: (target) => {
        const id = actorIdFromTarget(target);
        if (id) void retagActor(id, tag);
      }
    });
  }
}
function registerActorDirectoryContextMenu() {
  const handler = (_appOrHtml, options) => {
    pushActorTagOptions(options);
  };
  Hooks.on("getActorContextOptions", handler);
  Hooks.on("getActorDirectoryEntryContext", handler);
}
var ENTRY_CONTEXT_PATCHED = "__tacticalInitiativeEntryContextPatched";
var ENTRY_CONTEXT_METHOD2 = "_getEntryContextOptions";
function trackerPrototype2() {
  const config = CONFIG;
  const fromClass = config.ui?.combat?.prototype;
  if (fromClass && typeof fromClass === "object") return fromClass;
  const directory = game.combats?.directory;
  return directory ? Object.getPrototypeOf(directory) : null;
}
function tryPatchTracker2() {
  try {
    const proto = trackerPrototype2();
    if (!proto) return false;
    if (proto[ENTRY_CONTEXT_PATCHED] === true) return true;
    const original = proto[ENTRY_CONTEXT_METHOD2];
    if (typeof original !== "function") return false;
    const wrapped = original;
    proto[ENTRY_CONTEXT_METHOD2] = function(...args) {
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
function registerTrackerContextMenu() {
  Hooks.once("ready", () => {
    if (tryPatchTracker2()) return;
    Hooks.on("getCombatantContextOptions", (_appOrHtml, options) => {
      pushTagOptions(options);
    });
  });
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
  const root = resolveElement2(html);
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

// src/adapter/top-bar.ts
var CONTAINER_ID = `${MODULE_ID}-top-bar`;
function enabled() {
  return game.settings.get(MODULE_ID, SETTINGS.ENABLE_TOP_BAR) === true;
}
function viewer() {
  const policy = game.settings.get(MODULE_ID, SETTINGS.PLAYER_HP_POLICY);
  return {
    isGM: game.user?.isGM === true,
    playerHpPolicy: policy === "none" ? "none" : "bar"
  };
}
function toCombatant(combatant) {
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
function toInput(combat) {
  return {
    combatants: combat.turns.map(toCombatant),
    groups: combat.groups.contents.map((group) => ({ id: group.id, name: group.name, color: groupColor(group) })),
    currentId: combat.combatant?.id ?? null
  };
}
function container() {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) return existing;
  const element = document.createElement("div");
  element.id = CONTAINER_ID;
  element.className = `${MODULE_ID}-top-bar`;
  (document.getElementById("ui-top") ?? document.body).appendChild(element);
  return element;
}
function focusToken(combatantId) {
  const location = findCombatant(combatantId);
  const tokenId = location?.combatant.tokenId ?? null;
  if (!tokenId) return;
  const token = canvas.tokens?.get(tokenId);
  token?.control({ releaseOthers: true });
  if (token?.center) canvas.pan?.({ x: token.center.x, y: token.center.y });
}
function openSheet(combatantId) {
  findCombatant(combatantId)?.combatant.actor?.sheet?.render(true);
}
function closeMenu() {
  document.getElementById(`${MODULE_ID}-tb-menu`)?.remove();
}
function openMenu(rowEl, x, y) {
  closeMenu();
  const entries = [];
  pushTagOptions(entries);
  pushGroupOptions(entries);
  const visible = entries.filter((entry) => {
    try {
      return entry.condition(rowEl);
    } catch {
      return false;
    }
  });
  if (visible.length === 0) return;
  const menu = document.createElement("nav");
  menu.id = `${MODULE_ID}-tb-menu`;
  menu.className = `${MODULE_ID}-tb-menu`;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const entry of visible) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `${MODULE_ID}-tb-menu-item`;
    item.textContent = entry.name;
    item.addEventListener("click", () => {
      closeMenu();
      try {
        entry.callback(rowEl);
      } catch (error) {
        console.error(`${MODULE_ID} | top-bar menu`, error);
      }
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  window.addEventListener("pointerdown", closeMenu, { once: true });
}
function renderRow(row) {
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
      bar.style.width = `${Math.max(0, Math.min(100, row.hp.value / row.hp.max * 100))}%`;
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
      openMenu(li, event.clientX, event.clientY);
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
function renderControls(combat) {
  const bar = document.createElement("div");
  bar.className = `${MODULE_ID}-tb-controls`;
  const round = document.createElement("span");
  round.className = `${MODULE_ID}-tb-round`;
  round.textContent = game.i18n.format("TACTICAL_INITIATIVE.Tracker.Round", { n: String(combat.round) });
  bar.appendChild(round);
  const button = (action, icon, key, run) => {
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
function render() {
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
function registerTopBar() {
  Hooks.once("ready", render);
  for (const hook of ["updateCombat", "updateCombatant", "createCombatant", "deleteCombatant", "deleteCombat"]) {
    Hooks.on(hook, () => {
      render();
    });
  }
}

// src/main.ts
Hooks.once("init", () => {
  registerSettings();
  registerQueryHandler();
  registerHooks();
  registerCombatEvents();
  registerTrackerContextMenu();
  registerActorDirectoryContextMenu();
  registerSheetTagControl();
  registerGroupUI();
  registerTopBar();
  console.log(`${MODULE_ID} | initialized`);
});
//# sourceMappingURL=main.js.map
