import { describe, expect, it } from "vitest";
import {
  groupIdOf,
  majorityName,
  nextGroupName,
  partitionByGroup,
  resolveGroupChoice,
  type GroupRef
} from "../src/logic/group";
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

describe("groupIdOf", () => {
  it("prefers the raw _source id", () => {
    expect(groupIdOf({ _source: { group: "g1" }, group: { id: "other" } })).toBe("g1");
  });
  it("reads a string group field", () => {
    expect(groupIdOf({ group: "g2" })).toBe("g2");
  });
  it("reads the id of a resolved group document", () => {
    expect(groupIdOf({ group: { id: "g3" } })).toBe("g3");
  });
  it("returns null when ungrouped or empty", () => {
    expect(groupIdOf({})).toBeNull();
    expect(groupIdOf({ _source: { group: null }, group: null })).toBeNull();
    expect(groupIdOf({ _source: { group: "" }, group: "" })).toBeNull();
  });
});

describe("majorityName", () => {
  it("returns the most frequent name, first-seen on ties", () => {
    expect(majorityName(["Wolf", "Goblin", "Goblin", "Wolf", "Orc"])).toBe("Wolf");
    expect(majorityName(["Goblin", "Goblin", "Wolf"])).toBe("Goblin");
  });
  it("ignores blank names and returns null when none remain", () => {
    expect(majorityName(["", "  "])).toBeNull();
    expect(majorityName([])).toBeNull();
  });
});

describe("nextGroupName", () => {
  it("uses the base when free", () => {
    expect(nextGroupName(["Wolf"], "Goblin")).toBe("Goblin");
  });
  it("appends the lowest free number", () => {
    expect(nextGroupName(["Goblin", "Goblin 2"], "Goblin")).toBe("Goblin 3");
  });
  it("reuses a gap left by a disbanded group", () => {
    expect(nextGroupName(["Goblin", "Goblin 3"], "Goblin")).toBe("Goblin 2");
  });
});

describe("resolveGroupChoice", () => {
  const groups: GroupRef[] = [{ id: "g1", name: "Goblin", color: "#00ff00" }];
  it("returns none for an empty selection", () => {
    expect(resolveGroupChoice([], groups)).toEqual({ kind: "none" });
  });
  it("creates immediately when the combat has no groups", () => {
    expect(resolveGroupChoice([{ combatantId: null, groupId: null }], [])).toEqual({ kind: "create" });
  });
  it("prompts with the groups when some exist", () => {
    expect(resolveGroupChoice([{ combatantId: "c1", groupId: null }], groups)).toEqual({
      kind: "prompt",
      options: groups,
      offerRemove: false
    });
  });
  it("offers remove only when a selected combatant is grouped", () => {
    const choice = resolveGroupChoice(
      [
        { combatantId: "c1", groupId: "g1" },
        { combatantId: null, groupId: null }
      ],
      groups
    );
    expect(choice).toMatchObject({ kind: "prompt", offerRemove: true });
  });
});
