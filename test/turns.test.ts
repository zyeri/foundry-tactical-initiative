import { describe, expect, it } from "vitest";
import { adjustTurn, groupTieBreak, type TurnRef } from "../src/logic/turns";

function t(id: string, groupId: string | null = null, defeated = false): TurnRef {
  return { id, groupId, defeated };
}

// Order: solo a, group g (m1, m2, m3), solo b.
const turns = [t("a"), t("m1", "g"), t("m2", "g"), t("m3", "g"), t("b")];

describe("adjustTurn", () => {
  it("keeps a forward step from an ungrouped combatant", () => {
    expect(adjustTurn(turns, 0, 1, 1, false)).toEqual({ kind: "keep" });
  });
  it("forward from a group member skips the rest of the group", () => {
    expect(adjustTurn(turns, 1, 2, 1, false)).toEqual({ kind: "set", turn: 4 });
  });
  it("forward skip past the end asks for next round", () => {
    const tail = [t("a"), t("m1", "g"), t("m2", "g")];
    expect(adjustTurn(tail, 1, 2, 1, false)).toEqual({ kind: "nextRound" });
  });
  it("forward skip also skips defeated combatants when skipDefeated is on", () => {
    const withDead = [t("m1", "g"), t("m2", "g"), t("x", null, true), t("b")];
    expect(adjustTurn(withDead, 0, 1, 1, true)).toEqual({ kind: "set", turn: 3 });
    expect(adjustTurn(withDead, 0, 1, 1, false)).toEqual({ kind: "set", turn: 2 });
  });
  it("backward lands on the first member of the target's group", () => {
    expect(adjustTurn(turns, 4, 3, -1, false)).toEqual({ kind: "set", turn: 1 });
  });
  it("backward onto an ungrouped combatant is kept", () => {
    expect(adjustTurn(turns, 1, 0, -1, false)).toEqual({ kind: "keep" });
  });
  it("keeps out-of-range targets untouched", () => {
    expect(adjustTurn(turns, 1, 9, 1, false)).toEqual({ kind: "keep" });
    expect(adjustTurn(turns, null, 0, 1, false)).toEqual({ kind: "keep" });
  });
  it("keeps when to === from on a grouped combatant (no-op reset update)", () => {
    expect(adjustTurn(turns, 1, 1, 1, false)).toEqual({ kind: "keep" });
    expect(adjustTurn(turns, 1, 1, -1, false)).toEqual({ kind: "keep" });
  });
  it("a combat that is a single group: forward off it asks for next round, but a reset to the same index is kept", () => {
    const soloGroup = [t("m1", "g"), t("m2", "g")];
    expect(adjustTurn(soloGroup, 0, 1, 1, false)).toEqual({ kind: "nextRound" });
    expect(adjustTurn(soloGroup, 0, 0, 1, false)).toEqual({ kind: "keep" });
  });
});

describe("groupTieBreak", () => {
  it("does not interfere when initiatives differ or are unset", () => {
    expect(groupTieBreak({ initiative: 15, groupId: "g" }, { initiative: 12, groupId: null })).toBe(0);
    expect(groupTieBreak({ initiative: null, groupId: "g" }, { initiative: null, groupId: "h" })).toBe(0);
  });
  it("keeps same-initiative members of one group together", () => {
    expect(groupTieBreak({ initiative: 12, groupId: "g" }, { initiative: 12, groupId: "g" })).toBe(0);
    expect(groupTieBreak({ initiative: 12, groupId: "g" }, { initiative: 12, groupId: "h" })).toBeLessThan(0);
    expect(groupTieBreak({ initiative: 12, groupId: "h" }, { initiative: 12, groupId: "g" })).toBeGreaterThan(0);
  });
  it("sorts ungrouped before grouped on a tie", () => {
    expect(groupTieBreak({ initiative: 12, groupId: null }, { initiative: 12, groupId: "g" })).toBeLessThan(0);
  });
});
