/**
 * @file The Group Selected action, orchestrated behind the {@link GroupingPort}
 * seam so the ordering rules are unit-tested against a fake: the target group is
 * decided (and created) BEFORE any combatant is created, so the createCombatant
 * hook sees new combatants as grouped and skips boss slots and tag prompts. The
 * Foundry binding lives in src/adapter/grouping.ts.
 */

import {
  majorityName,
  nextGroupName,
  resolveGroupChoice,
  type GroupRef,
  type SelRef
} from "./logic/group";

/** A combatant reduced to what grouping needs. */
export interface GroupingCombatantRef {
  id: string;
  tokenId: string | null;
  groupId: string | null;
  initiative: number | null;
  /** True for a boss's module-created "end" slot (shares the boss tokenId). */
  bossEndSlot: boolean;
}

/** What the group dialog is asked to show. */
export interface GroupPromptRequest {
  options: GroupRef[];
  offerRemove: boolean;
  defaultName: string;
}

/** The GM's answer from the group dialog; `null` when dismissed. */
export type GroupPromptResult =
  | { action: "new"; name: string }
  | { action: "join"; groupId: string }
  | { action: "remove" }
  | null;

/** The seam between {@link GroupingService} and Foundry. */
export interface GroupingPort {
  /** Find (or create) and activate the viewed scene's combat; `null` with no scene. */
  resolveCombat(): Promise<string | null>;
  /** Every combatant of the combat, in any order. */
  listCombatants(combatId: string): GroupingCombatantRef[];
  /** The combat's groups. */
  listGroups(combatId: string): GroupRef[];
  /** Whether the combat has started (round >= 1). */
  isStarted(combatId: string): boolean;
  /** Actor (or token) names for the given tokens, in order. */
  tokenActorNames(tokenIds: readonly string[]): string[];
  /** Localized base name used when no token name is available. */
  fallbackGroupName(): string;
  /** Create a CombatantGroup; resolves to its id. */
  createGroup(combatId: string, name: string): Promise<string>;
  /** Create combatants for tokens, born in `groupId`; resolves to their ids. */
  createCombatants(
    combatId: string,
    tokenIds: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<string[]>;
  /** Move combatants into a group; `initiative` null leaves initiative unchanged. */
  assign(combatId: string, ids: readonly string[], groupId: string, initiative: number | null): Promise<void>;
  /** Clear combatants' group. */
  unassign(combatId: string, ids: readonly string[]): Promise<void>;
  /** Delete a CombatantGroup. */
  deleteGroup(combatId: string, groupId: string): Promise<void>;
  /** Roll one initiative for a group; `null` if it cannot roll. */
  rollGroupInitiative(combatId: string, groupId: string): Promise<number | null>;
  /** Set the same initiative on several combatants in one batch. */
  setInitiative(combatId: string, ids: readonly string[], value: number): Promise<void>;
  /** Remove boss double-turn slots from combatants that just joined a group. */
  tearDownBoss(combatId: string, ids: readonly string[]): Promise<void>;
  /** Restore boss double-turn slots for combatants that just left a group. */
  reconcileBoss(combatId: string, ids: readonly string[]): Promise<void>;
  /** Show the group dialog. */
  prompt(request: GroupPromptRequest): Promise<GroupPromptResult>;
  /** Show a localized warning. */
  warn(key: "NothingSelected" | "NoScene"): void;
}

/** Runs the battlemap Group Selected action. */
export class GroupingService {
  /**
   * @param port - The Foundry seam.
   */
  public constructor(private readonly port: GroupingPort) {}

  /**
   * Group the given tokens: add missing ones to combat, then create, join, or
   * leave a group per {@link resolveGroupChoice} and the GM's dialog answer.
   *
   * @param tokenIds - Selected token ids (duplicates allowed).
   */
  public async groupSelected(tokenIds: readonly string[]): Promise<void> {
    const unique = [...new Set(tokenIds)];
    if (unique.length === 0) {
      this.port.warn("NothingSelected");
      return;
    }
    const combatId = await this.port.resolveCombat();
    if (combatId === null) {
      this.port.warn("NoScene");
      return;
    }
    const before = this.port.listCombatants(combatId);
    const byToken = new Map<string, GroupingCombatantRef>();
    for (const combatant of before) {
      if (combatant.bossEndSlot || combatant.tokenId === null) continue;
      if (!unique.includes(combatant.tokenId) || byToken.has(combatant.tokenId)) continue;
      byToken.set(combatant.tokenId, combatant);
    }
    const inCombat = [...byToken.values()];
    const newTokens = unique.filter((tokenId) => !byToken.has(tokenId));
    const selected: SelRef[] = [
      ...inCombat.map((c) => ({ combatantId: c.id, groupId: c.groupId })),
      ...newTokens.map(() => ({ combatantId: null, groupId: null }))
    ];
    const groups = this.port.listGroups(combatId);
    const choice = resolveGroupChoice(selected, groups);
    if (choice.kind === "none") return;
    const base = majorityName(this.port.tokenActorNames(unique)) ?? this.port.fallbackGroupName();
    const defaultName = nextGroupName(
      groups.map((group) => group.name),
      base
    );
    const result: GroupPromptResult =
      choice.kind === "create"
        ? { action: "new", name: defaultName }
        : await this.port.prompt({ options: choice.options, offerRemove: choice.offerRemove, defaultName });
    if (result === null) return;
    if (result.action === "remove") {
      await this.leave(
        combatId,
        inCombat.filter((c) => c.groupId !== null)
      );
      return;
    }
    const targetId =
      result.action === "join"
        ? result.groupId
        : await this.port.createGroup(combatId, result.name.trim() || defaultName);
    await this.join(combatId, before, inCombat, newTokens, targetId);
  }

  /** Put selected combatants and new tokens into `targetId`, then settle initiative. */
  private async join(
    combatId: string,
    before: readonly GroupingCombatantRef[],
    inCombat: readonly GroupingCombatantRef[],
    newTokens: readonly string[],
    targetId: string
  ): Promise<void> {
    const started = this.port.isStarted(combatId);
    const shared = started
      ? (before.find((c) => c.groupId === targetId && c.initiative !== null)?.initiative ?? null)
      : null;
    const moving = inCombat.filter((c) => c.groupId !== targetId).map((c) => c.id);
    if (moving.length > 0) {
      await this.port.assign(combatId, moving, targetId, shared);
      await this.port.tearDownBoss(combatId, moving);
    }
    if (newTokens.length > 0) await this.port.createCombatants(combatId, newTokens, targetId, shared);
    if (started && shared === null && (moving.length > 0 || newTokens.length > 0)) {
      const value = await this.port.rollGroupInitiative(combatId, targetId);
      if (value !== null) {
        const members = this.port
          .listCombatants(combatId)
          .filter((c) => c.groupId === targetId)
          .map((c) => c.id);
        await this.port.setInitiative(combatId, members, value);
      }
    }
    await this.sweep(
      combatId,
      inCombat.map((c) => c.groupId)
    );
  }

  /** Remove combatants from their groups and restore their boss slots. */
  private async leave(combatId: string, refs: readonly GroupingCombatantRef[]): Promise<void> {
    if (refs.length === 0) return;
    const ids = refs.map((ref) => ref.id);
    await this.port.unassign(combatId, ids);
    await this.port.reconcileBoss(combatId, ids);
    await this.sweep(
      combatId,
      refs.map((ref) => ref.groupId)
    );
  }

  /** Delete any candidate group that no longer has members. */
  private async sweep(combatId: string, candidates: readonly (string | null)[]): Promise<void> {
    const used = new Set(this.port.listCombatants(combatId).map((c) => c.groupId));
    for (const groupId of new Set(candidates)) {
      if (groupId !== null && !used.has(groupId)) await this.port.deleteGroup(combatId, groupId);
    }
  }
}
