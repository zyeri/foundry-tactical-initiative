import { describe, expect, it } from "vitest";
import { buildTrackerView, type TrackerCombatant, type TrackerInput, type Viewer } from "../src/logic/tracker-view";

function c(over: Partial<TrackerCombatant> & { id: string }): TrackerCombatant {
  return {
    id: over.id,
    name: over.name ?? over.id,
    img: over.img ?? `${over.id}.png`,
    initiative: over.initiative ?? 10,
    tag: over.tag ?? "mob",
    groupId: over.groupId ?? null,
    hidden: over.hidden ?? false,
    isDefeated: over.isDefeated ?? false,
    ownedByViewer: over.ownedByViewer ?? false,
    hp: over.hp ?? { value: 7, max: 10 },
    conditions: over.conditions ?? []
  };
}

const GM: Viewer = { isGM: true, playerHpPolicy: "bar" };
const PLAYER: Viewer = { isGM: false, playerHpPolicy: "bar" };

function input(combatants: TrackerCombatant[], currentId: string | null = null): TrackerInput {
  return { combatants, groups: [{ id: "g", name: "Goblins", color: "#00ff00" }], currentId };
}

describe("buildTrackerView", () => {
  it("keeps turn order and marks the current combatant", () => {
    const rows = buildTrackerView(input([c({ id: "a" }), c({ id: "b" })], "b"), GM);
    expect(rows.map((r) => r.kind === "combatant" && r.combatantId)).toEqual(["a", "b"]);
    expect(rows[1]).toMatchObject({ isCurrent: true });
    expect(rows[0]).toMatchObject({ isCurrent: false });
  });

  it("hides unowned hidden combatants from a player but not the GM", () => {
    const combatants = [c({ id: "a" }), c({ id: "secret", hidden: true })];
    expect(buildTrackerView(input(combatants), PLAYER)).toHaveLength(1);
    expect(buildTrackerView(input(combatants), GM)).toHaveLength(2);
  });

  it("shows a hidden combatant the player owns", () => {
    const rows = buildTrackerView(input([c({ id: "mine", hidden: true, ownedByViewer: true })]), PLAYER);
    expect(rows).toHaveLength(1);
  });

  it("applies HP policy: full for GM/owner, bar or none otherwise", () => {
    const target = c({ id: "x", hp: { value: 3, max: 9 } });
    const gmRow = buildTrackerView(input([target]), GM)[0];
    const barRow = buildTrackerView(input([target]), PLAYER)[0];
    const noneRow = buildTrackerView(input([target]), { isGM: false, playerHpPolicy: "none" })[0];
    expect(gmRow).toMatchObject({ hp: { value: 3, max: 9, shown: "full" } });
    expect(barRow).toMatchObject({ hp: { value: 3, max: 9, shown: "bar" } });
    expect(noneRow).toMatchObject({ hp: { value: null, max: null, shown: "none" } });
  });

  it("collapses a group into one row at its first-seen position, current if any member is", () => {
    const rows = buildTrackerView(
      input([c({ id: "solo" }), c({ id: "m1", groupId: "g" }), c({ id: "m2", groupId: "g" })], "m2"),
      GM
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "combatant", combatantId: "solo" });
    expect(rows[1]).toMatchObject({ kind: "group", groupId: "g", name: "Goblins", color: "#00ff00", memberCount: 2, isCurrent: true });
  });

  it("counts only visible members in a collapsed group", () => {
    const rows = buildTrackerView(
      input([c({ id: "m1", groupId: "g" }), c({ id: "m2", groupId: "g", hidden: true })]),
      PLAYER
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "group", memberCount: 1 });
  });

  it("carries tag and defeated on a combatant row", () => {
    const rows = buildTrackerView(input([c({ id: "b", tag: "boss", isDefeated: true })]), GM);
    expect(rows[0]).toMatchObject({ kind: "combatant", tag: "boss", isDefeated: true });
  });
});
