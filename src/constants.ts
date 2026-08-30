/**
 * @file Shared, side-effect-free constants and string-literal unions for the
 * Tactical Initiative module. Importing this file must never touch Foundry
 * globals, so it is safe to use from both the pure logic layer and the tests.
 */

/** The module id, matching the `id` field in `module.json`. */
export const MODULE_ID = "tactical-initiative" as const;

/**
 * Flag keys stored under `flags["tactical-initiative"]` on actors, combatants,
 * and active effects.
 */
export const FLAGS = {
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
} as const;

/**
 * The tactical tag applied to an actor. Determines its initiative behavior.
 * - `player` — prompted to Rush / March / Hunker Down each roll.
 * - `boss`   — never rolls; acts at the start and end of every round.
 * - `mob`    — rolls initiative normally.
 */
export type Tag = "player" | "boss" | "mob";

/** All valid {@link Tag} values, in display order. */
export const TAGS: readonly Tag[] = ["player", "boss", "mob"];

/**
 * A player's per-round initiative choice.
 * - `rush`   — faster initiative, penalty to d20 rolls.
 * - `march`  — normal initiative, no effect. Also the fallback when no answer.
 * - `hunker` — slower initiative, bonus to d20 rolls.
 */
export type Choice = "rush" | "march" | "hunker";

/** All valid {@link Choice} values. */
export const CHOICES: readonly Choice[] = ["rush", "march", "hunker"];

/** Which boss turn a combatant entry represents. */
export type BossSlot = "start" | "end";

/**
 * Flat initiative adjustment applied on top of the normal roll for each choice.
 * Rush is faster (+3), Hunker Down is slower (−6), March is unchanged.
 */
export const CHOICE_INIT_ADJUST: Readonly<Record<Choice, number>> = {
  rush: 3,
  march: 0,
  hunker: -6
};

/**
 * The signed d20 modifier granted by each choice's temporary Active Effect.
 * Rush imposes −1 to attacks/saves/checks; Hunker Down grants +2; March: none.
 * `march` maps to `0`, meaning no effect is created.
 */
export const CHOICE_EFFECT_MODIFIER: Readonly<Record<Choice, number>> = {
  rush: -1,
  march: 0,
  hunker: 2
};

/**
 * dnd5e system bonus paths that a temporary effect writes to so the modifier
 * applies to attack rolls, saving throws, and ability checks.
 */
export const DND5E_BONUS_KEYS: readonly string[] = [
  "system.bonuses.mwak.attack",
  "system.bonuses.rwak.attack",
  "system.bonuses.msak.attack",
  "system.bonuses.rsak.attack",
  "system.bonuses.abilities.check",
  "system.bonuses.abilities.save"
];

/** ActiveEffect change mode ADD, mirroring `CONST.ACTIVE_EFFECT_MODES.ADD`. */
export const ACTIVE_EFFECT_MODE_ADD = 2 as const;

/**
 * ActiveEffect change type ADD for Foundry v14+, where numeric `mode` was
 * replaced by a string `type` (`CONST.ACTIVE_EFFECT_CHANGE_TYPES`) and the
 * `changes` array moved from the document root to `system.changes`.
 */
export const ACTIVE_EFFECT_TYPE_ADD = "add" as const;

/**
 * The first Foundry generation that uses the v14 ActiveEffect schema
 * (`system.changes` with string `type`). Below this the module emits the legacy
 * root-`changes` + numeric `mode` shape.
 */
export const V14_GENERATION = 14 as const;

/**
 * Base initiative values for boss slots. Start slots sort above any normal roll;
 * end slots sort below any normal roll. A per-boss rank is subtracted from each so
 * multiple bosses keep the same relative order at the start and at the end.
 */
export const BOSS_START_BASE = 10000 as const;
export const BOSS_END_BASE = -10000 as const;

/** The query name used to ask an owning player for their initiative choice. */
export const QUERY_CHOOSE = `${MODULE_ID}.chooseInitiative` as const;

/** Module setting keys. */
export const SETTINGS = {
  /** World setting: seconds to wait for a player's choice before defaulting to March. */
  PLAYER_TIMEOUT: "playerTimeoutSeconds",
  /** World setting: whether a boss death posts a public chat callout. */
  ANNOUNCE_BOSS_DEATH: "announceBossDeath",
  /** World setting: seconds a recorded damage source stays valid for kill attribution. */
  KILL_WINDOW: "killAttributionWindowSeconds"
} as const;

/** Default staleness window (seconds) for F5 kill attribution. */
export const DEFAULT_KILL_WINDOW_SECONDS = 45 as const;
