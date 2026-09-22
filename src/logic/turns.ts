/**
 * @file Pure turn-order rules that make a combatant group act once: turn skipping
 * across a group's members and a sort tie-break that keeps members adjacent. No
 * Foundry globals; the adapter maps Combat state in and applies the result.
 */

/** One entry of `combat.turns`, reduced to what turn skipping needs. */
export interface TurnRef {
  id: string;
  groupId: string | null;
  defeated: boolean;
}

/** How to change a pending turn update. */
export type TurnAdjust = { kind: "keep" } | { kind: "set"; turn: number } | { kind: "nextRound" };

/**
 * Adjust a pending turn change so a group takes one turn. Forward from a grouped
 * combatant skips its remaining members (and defeated combatants when
 * `skipDefeated`); running off the end asks for the next round. Backward onto a
 * grouped combatant lands on that group's first member.
 *
 * @param turns - `combat.turns` in order.
 * @param from - The current turn index, or `null` before the first turn.
 * @param to - The turn index core is about to set.
 * @param direction - `1` forward, `-1` backward.
 * @param skipDefeated - The combat's "skip defeated" setting.
 * @returns The {@link TurnAdjust}.
 */
export function adjustTurn(
  turns: readonly TurnRef[],
  from: number | null,
  to: number,
  direction: 1 | -1,
  skipDefeated: boolean
): TurnAdjust {
  if (from === null || to < 0 || to >= turns.length) return { kind: "keep" };
  if (direction === 1) {
    const groupId = turns[from]?.groupId ?? null;
    if (groupId === null) return { kind: "keep" };
    let index = to;
    while (index < turns.length) {
      const entry = turns[index];
      if (!entry) break;
      const sameGroup = entry.groupId === groupId;
      const skippable = skipDefeated && entry.defeated;
      if (!sameGroup && !skippable) break;
      index += 1;
    }
    if (index >= turns.length) return { kind: "nextRound" };
    return index === to ? { kind: "keep" } : { kind: "set", turn: index };
  }
  const groupId = turns[to]?.groupId ?? null;
  if (groupId === null) return { kind: "keep" };
  let index = to;
  while (index > 0 && turns[index - 1]?.groupId === groupId) index -= 1;
  return index === to ? { kind: "keep" } : { kind: "set", turn: index };
}

/** A combatant reduced to what the sort tie-break needs. */
export interface SortRef {
  initiative: number | null;
  groupId: string | null;
}

/**
 * Tie-break for equal initiative so a group's members stay adjacent: compare
 * group ids (ungrouped first). Returns 0 when initiatives differ or are unset, so
 * the caller falls through to core ordering.
 *
 * @param a - First combatant.
 * @param b - Second combatant.
 * @returns Negative, zero, or positive, as for `Array.prototype.sort`.
 */
export function groupTieBreak(a: SortRef, b: SortRef): number {
  if (a.initiative === null || b.initiative === null || a.initiative !== b.initiative) return 0;
  const keyA = a.groupId ?? "";
  const keyB = b.groupId ?? "";
  if (keyA === keyB) return 0;
  return keyA < keyB ? -1 : 1;
}
