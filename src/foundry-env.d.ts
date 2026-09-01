/**
 * @file Narrow ambient declarations for the subset of the FoundryVTT v13 + dnd5e
 * runtime this module touches. These are intentionally minimal - just the members
 * the adapter uses - so strict TypeScript stays meaningful without pulling in a
 * full, version-fragile types package. This file is a script (no imports/exports),
 * so every declaration below is globally ambient.
 */

/** A minimal read view of Foundry's Collection/EmbeddedCollection. */
interface FoundryCollection<T> {
  get(id: string): T | undefined;
  filter(predicate: (value: T) => boolean): T[];
  map<U>(transform: (value: T) => U): U[];
  find(predicate: (value: T) => boolean): T | undefined;
  values(): IterableIterator<T>;
  readonly contents: T[];
  readonly size: number;
}

/** A Foundry Roll, evaluated to produce a numeric total. */
interface FoundryRoll {
  evaluate(): Promise<FoundryRoll>;
  readonly total: number;
}

/** A dnd5e/core ActiveEffect document (subset). */
interface FoundryActiveEffect {
  readonly id: string;
  readonly name: string;
  getFlag(scope: string, key: string): unknown;
}

/** A core/dnd5e Actor document (subset). */
interface FoundryActor {
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly type: string;
  readonly effects: FoundryCollection<FoundryActiveEffect>;
  getFlag(scope: string, key: string): unknown;
  setFlag(scope: string, key: string, value: unknown): Promise<FoundryActor>;
  unsetFlag(scope: string, key: string): Promise<FoundryActor>;
  testUserPermission(user: FoundryUser, permission: string): boolean;
  createEmbeddedDocuments(type: string, data: object[]): Promise<FoundryActiveEffect[]>;
  deleteEmbeddedDocuments(type: string, ids: string[]): Promise<FoundryActiveEffect[]>;
  /** Roll data for `@`-substitution in formulas. */
  getRollData?(): object;
  /** dnd5e Actor5e initiative Roll builder (older/parallel to Combatant5e's). */
  getInitiativeRoll?(formula?: string): FoundryRoll;
  /** True when this is a synthetic actor backing an unlinked token. */
  readonly isToken?: boolean;
  /** For a token actor, its TokenDocument; otherwise null. */
  readonly token?: FoundryTokenDocument | null;
  /** dnd5e system data (subset): current hit points. */
  readonly system?: { attributes?: { hp?: { value?: number } } };
  /** Tokens for this actor on the active scene. Pass (false, true) for documents. */
  getActiveTokens(linked?: boolean, document?: boolean): FoundryTokenDocument[];
}

/** A core TokenDocument (subset used by F4). */
interface FoundryTokenDocument {
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly actorId: string | null;
  /** The scene this token belongs to. */
  readonly parent: { id: string } | null;
  update(data: object): Promise<FoundryTokenDocument>;
}

/** A ChatMessage document (subset used to capture dnd5e damage cards). */
interface FoundryChatMessage {
  readonly speaker?: { actor?: string; alias?: string };
  readonly flags?: {
    dnd5e?: {
      roll?: { type?: string };
      item?: { uuid?: string };
      // `uuid` in dnd5e 5.3; a later dnd5e renames the descriptor field to `actor`.
      targets?: { uuid?: string; actor?: string }[];
    };
  };
}

/** A core/dnd5e Combatant document (subset). */
interface FoundryCombatant {
  readonly id: string;
  readonly actorId: string | null;
  readonly tokenId: string | null;
  readonly sceneId: string | null;
  readonly actor: FoundryActor | null;
  readonly initiative: number | null;
  readonly isDefeated: boolean;
  /** The native CombatantGroup id, or null/empty when ungrouped. */
  readonly group?: string | null;
  /** Active users who own the combatant's actor. */
  readonly players: FoundryUser[];
  readonly combat: FoundryCombat | null;
  getFlag(scope: string, key: string): unknown;
  update(data: object): Promise<FoundryCombatant>;
  delete(): Promise<FoundryCombatant>;
  /** dnd5e Combatant5e builds the full initiative Roll (init bonuses, Alert, ...). */
  getInitiativeRoll?(formula?: string): FoundryRoll;
}

/** A native CombatantGroup document (subset). */
interface FoundryCombatantGroup {
  readonly id: string;
  readonly name: string;
  readonly initiative: number | null;
  getFlag(scope: string, key: string): unknown;
  update(data: object): Promise<FoundryCombatantGroup>;
  setFlag(scope: string, key: string, value: unknown): Promise<FoundryCombatantGroup>;
  delete(): Promise<FoundryCombatantGroup>;
}

/** A core/dnd5e Combat document (subset). */
interface FoundryCombat {
  readonly id: string;
  readonly started: boolean;
  readonly round: number;
  readonly turns: FoundryCombatant[];
  readonly combatants: FoundryCollection<FoundryCombatant>;
  readonly groups: FoundryCollection<FoundryCombatantGroup>;
  createEmbeddedDocuments(type: string, data: object[]): Promise<FoundryCombatant[]>;
  updateEmbeddedDocuments(type: string, updates: object[]): Promise<unknown[]>;
  deleteEmbeddedDocuments(type: string, ids: string[]): Promise<unknown[]>;
  update(data: object): Promise<FoundryCombat>;
}

/** A Foundry User document (subset). */
interface FoundryUser {
  readonly id: string;
  readonly isGM: boolean;
  readonly active: boolean;
  /** v13 socketless query mechanism; rejects or resolves per registered handler. */
  query(queryName: string, queryData: object, options?: { timeout?: number }): Promise<unknown>;
}

/** The users collection, with the active-GM election getter. */
interface FoundryUsers extends FoundryCollection<FoundryUser> {
  /** The single active GM designated to run world-mutating logic, or null. */
  readonly activeGM: FoundryUser | null;
}

/** Foundry's settings registry (subset). */
interface FoundrySettings {
  register(namespace: string, key: string, data: object): void;
  get(namespace: string, key: string): unknown;
}

/** Foundry's i18n helper (subset). */
interface FoundryI18n {
  localize(key: string): string;
  format(key: string, data: Record<string, string>): string;
}

/** Foundry's release/version descriptor (subset). */
interface FoundryRelease {
  /** The major generation number, e.g. `13` or `14`. */
  readonly generation: number;
}

/** The global game object (subset). */
interface FoundryGame {
  /** The running Foundry release; used to branch on version-specific schemas. */
  readonly release?: FoundryRelease;
  readonly user: FoundryUser | null;
  readonly users: FoundryUsers | null;
  readonly actors: FoundryCollection<FoundryActor> | null;
  readonly combats: (FoundryCollection<FoundryCombat> & { active: FoundryCombat | null }) | null;
  readonly settings: FoundrySettings;
  readonly i18n: FoundryI18n;
}

/** A DialogV2 button definition. */
interface DialogV2Button {
  action: string;
  label: string;
  default?: boolean;
}

/** DialogV2.wait configuration (subset). */
interface DialogV2WaitConfig {
  window: { title: string };
  content: string;
  buttons: DialogV2Button[];
  rejectClose?: boolean;
  modal?: boolean;
}

/** The DialogV2 application class (subset). */
interface DialogV2Static {
  wait(config: DialogV2WaitConfig): Promise<string | null>;
}

/** ChatMessage document class (subset). */
interface ChatMessageStatic {
  create(data: object): Promise<unknown>;
}

/** Notifications UI (subset). */
interface FoundryNotifications {
  warn(message: string): void;
  info(message: string): void;
}

/**
 * The Hooks event bus (subset). Handler args are `any[]` because Foundry hook
 * payloads vary per event; handlers below narrow them explicitly. This `any` is
 * confined to the framework boundary - module code stays strictly typed.
 */
interface FoundryHooks {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(hook: string, fn: (...args: any[]) => unknown): number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(hook: string, fn: (...args: any[]) => unknown): number;
}

/** CONFIG.queries handler map plus the rest of CONFIG (untyped here). */
interface FoundryConfig {
  queries: Record<string, (queryData: object, options: { timeout?: number }) => Promise<unknown>>;
}

// ----- Ambient globals provided by Foundry at runtime -----

declare const game: FoundryGame;
declare const Hooks: FoundryHooks;

/** Foundry's Roll class (subset). */
declare const Roll: {
  new (formula: string, data?: object): FoundryRoll;
};

declare const CONFIG: FoundryConfig;
declare const ChatMessage: ChatMessageStatic;
declare const ui: { notifications?: FoundryNotifications };

/** Foundry's synchronous UUID resolver (subset: names for items, docs for tokens). */
declare function fromUuidSync(uuid: string): { name?: string } | null;

/** The `foundry` global namespace (only the pieces used here). */
declare const foundry: {
  applications: {
    api: {
      DialogV2: DialogV2Static;
    };
  };
};
