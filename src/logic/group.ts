/**
 * @file Pure grouping logic: partition combatants into native groups and the
 * ungrouped remainder. No Foundry globals, no side effects.
 */

import type { CombatantView } from "../types";

/** A single group and its members, plus the ungrouped remainder. */
export interface GroupPartition {
  /** Groups in first-seen encounter order. */
  groups: { groupId: string; members: CombatantView[] }[];
  /** Combatants not in any group. */
  ungrouped: CombatantView[];
}

/**
 * Split combatants into groups (keyed by `groupId`) and the ungrouped remainder,
 * preserving encounter order by each group's first-seen member.
 *
 * @param combatants - The combatants to partition.
 * @returns The {@link GroupPartition}.
 */
export function partitionByGroup(combatants: readonly CombatantView[]): GroupPartition {
  const ungrouped: CombatantView[] = [];
  const groups: { groupId: string; members: CombatantView[] }[] = [];
  const byId = new Map<string, { groupId: string; members: CombatantView[] }>();
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

/** Anything carrying a native group reference: a Combatant or a test double. */
export interface GroupCarrier {
  /** Raw stored data; `group` here is always the id string when set. */
  _source?: { group?: string | null } | null;
  /** The runtime field: an id string, the resolved CombatantGroup, or null. */
  group?: string | { id: string } | null;
}

/**
 * Read a combatant's CombatantGroup id regardless of whether the runtime field
 * holds the id or the resolved document (v14 resolves it to the document).
 *
 * @param c - The combatant (or test double).
 * @returns The group id, or `null` when ungrouped.
 */
export function groupIdOf(c: GroupCarrier): string | null {
  const raw = c._source?.group;
  if (typeof raw === "string" && raw.length > 0) return raw;
  const field = c.group;
  if (typeof field === "string") return field.length > 0 ? field : null;
  if (field && typeof field.id === "string" && field.id.length > 0) return field.id;
  return null;
}

/** A group as offered to the GM. */
export interface GroupRef {
  id: string;
  name: string;
  /** Tag color, or `null` for the default. */
  color: string | null;
}

/** One selected token: its combatant (or `null` if not in combat yet) and group. */
export interface SelRef {
  combatantId: string | null;
  groupId: string | null;
}

/** What the Group Selected action should do before any write. */
export type GroupChoice =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "prompt"; options: GroupRef[]; offerRemove: boolean };

/**
 * Decide the Group Selected interaction: nothing for an empty selection, an
 * immediate new group when the combat has none, otherwise a prompt listing the
 * existing groups (with "remove" only when a selected combatant is grouped).
 *
 * @param selected - The selected tokens.
 * @param groups - The combat's existing groups.
 * @returns The {@link GroupChoice}.
 */
export function resolveGroupChoice(selected: readonly SelRef[], groups: readonly GroupRef[]): GroupChoice {
  if (selected.length === 0) return { kind: "none" };
  if (groups.length === 0) return { kind: "create" };
  return {
    kind: "prompt",
    options: [...groups],
    offerRemove: selected.some((sel) => sel.groupId !== null)
  };
}

/**
 * The most frequent non-blank name, first-seen on ties.
 *
 * @param names - Candidate names (e.g. the selected tokens' actor names).
 * @returns The majority name, or `null` when there is none.
 */
export function majorityName(names: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length === 0) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The lowest unused group name: `base`, else `base 2`, `base 3`, ...
 *
 * @param existing - Names already used in the combat.
 * @param base - The preferred name.
 * @returns A name not in `existing`.
 */
export function nextGroupName(existing: readonly string[], base: string): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
