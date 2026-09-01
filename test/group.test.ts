import { describe, expect, it } from "vitest";
import { partitionByGroup } from "../src/logic/group";
import type { CombatantView } from "../src/types";

function view(id: string, groupId: string | null): CombatantView {
  return {
    id,
    actorId: `${id}-a`,
    actorName: id,
    tag: "mob",
    isDefeated: false,
    bossSlot: null,
    bossRank: null,
    groupId
  };
}

describe("partitionByGroup", () => {
  it("separates ungrouped combatants from groups", () => {
    const result = partitionByGroup([view("a", null), view("b", "g1"), view("c", "g1")]);
    expect(result.ungrouped.map((c) => c.id)).toEqual(["a"]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.groupId).toBe("g1");
    expect(result.groups[0]?.members.map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("preserves group encounter order by first-seen member", () => {
    const result = partitionByGroup([view("a", "g2"), view("b", "g1"), view("c", "g2")]);
    expect(result.groups.map((g) => g.groupId)).toEqual(["g2", "g1"]);
  });

  it("returns no groups when nothing is grouped", () => {
    const result = partitionByGroup([view("a", null), view("b", null)]);
    expect(result.groups).toEqual([]);
    expect(result.ungrouped).toHaveLength(2);
  });
});
