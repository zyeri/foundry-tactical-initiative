/**
 * @file Pure combat-tracker view model: turn order + per-viewer visibility and
 * HP filtering + group collapse, with no Foundry globals or side effects. The
 * top-bar adapter reads Foundry docs into a TrackerInput, calls this, and paints
 * the rows.
 */

import type { Tag } from "../constants";

/** How a combatant's HP is shown to a given viewer. */
export interface TrackerHp {
  /** Current HP, or null when not shown. */
  value: number | null;
  /** Max HP, or null when not shown. */
  max: number | null;
  /** Render mode: numbers, a ratio bar only, or nothing. */
  shown: "full" | "bar" | "none";
}

/** A combatant reduced to what the view model needs (no Foundry types). */
export interface TrackerCombatant {
  id: string;
  name: string;
  img: string | null;
  initiative: number | null;
  tag: Tag | null;
  groupId: string | null;
  hidden: boolean;
  isDefeated: boolean;
  ownedByViewer: boolean;
  hp: { value: number | null; max: number | null };
  conditions: readonly string[];
}

/** Group metadata (name + tag color) for collapsed group rows. */
export interface TrackerGroup {
  id: string;
  name: string;
  color: string;
}

/** The full input to {@link buildTrackerView}. */
export interface TrackerInput {
  /** Combatants in Foundry turn order. */
  combatants: readonly TrackerCombatant[];
  /** Group metadata by id. */
  groups: readonly TrackerGroup[];
  /** The current combatant id, or null. */
  currentId: string | null;
}

/** The viewer the bar is rendered for. */
export interface Viewer {
  isGM: boolean;
  /** How non-owned combatants' HP is shown to this (non-GM) viewer. */
  playerHpPolicy: "bar" | "none";
}

/** One rendered row: a single combatant, or a collapsed group. */
export type TrackerRow =
  | {
      kind: "combatant";
      combatantId: string;
      name: string;
      img: string | null;
      initiative: number | null;
      tag: Tag | null;
      hp: TrackerHp;
      conditions: readonly string[];
      isCurrent: boolean;
      isDefeated: boolean;
    }
  | {
      kind: "group";
      groupId: string;
      name: string;
      color: string;
      memberCount: number;
      initiative: number | null;
      img: string | null;
      isCurrent: boolean;
    };

/** Default group color when metadata is missing. */
const DEFAULT_GROUP_COLOR = "#8888ff";

/** Whether a combatant is visible to the viewer. */
function isVisible(combatant: TrackerCombatant, viewer: Viewer): boolean {
  return viewer.isGM || !combatant.hidden || combatant.ownedByViewer;
}

/** The HP view for a combatant and viewer, per ownership and policy. */
function hpFor(combatant: TrackerCombatant, viewer: Viewer): TrackerHp {
  if (viewer.isGM || combatant.ownedByViewer) {
    return { value: combatant.hp.value, max: combatant.hp.max, shown: "full" };
  }
  if (viewer.playerHpPolicy === "bar") {
    return { value: combatant.hp.value, max: combatant.hp.max, shown: "bar" };
  }
  return { value: null, max: null, shown: "none" };
}

/**
 * Build the ordered tracker rows for one viewer: filters invisible combatants,
 * applies the HP policy, and collapses each group into a single row at its
 * first visible member's position, preserving turn order.
 *
 * @param input - Combatants (in turn order), group metadata, current id.
 * @param viewer - The viewer to render for.
 * @returns The rows to paint, in order.
 */
export function buildTrackerView(input: TrackerInput, viewer: Viewer): TrackerRow[] {
  const meta = new Map(input.groups.map((group) => [group.id, group]));
  const rows: TrackerRow[] = [];
  const seenGroups = new Set<string>();
  for (const combatant of input.combatants) {
    if (!isVisible(combatant, viewer)) continue;
    if (combatant.groupId !== null) {
      if (seenGroups.has(combatant.groupId)) continue;
      seenGroups.add(combatant.groupId);
      const members = input.combatants.filter(
        (other) => other.groupId === combatant.groupId && isVisible(other, viewer)
      );
      const group = meta.get(combatant.groupId);
      rows.push({
        kind: "group",
        groupId: combatant.groupId,
        name: group?.name ?? "",
        color: group?.color ?? DEFAULT_GROUP_COLOR,
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
        hp: hpFor(combatant, viewer),
        conditions: combatant.conditions,
        isCurrent: combatant.id === input.currentId,
        isDefeated: combatant.isDefeated
      });
    }
  }
  return rows;
}
