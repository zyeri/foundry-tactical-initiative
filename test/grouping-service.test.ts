import { beforeEach, describe, expect, it } from "vitest";
import { GroupingService } from "../src/grouping-service";
import { FakeGroupingPort } from "./fake-grouping-port";

describe("GroupingService.groupSelected", () => {
  let port: FakeGroupingPort;
  let service: GroupingService;

  beforeEach(() => {
    port = new FakeGroupingPort();
    port.names = new Map([
      ["t1", "Goblin"],
      ["t2", "Goblin"],
      ["t3", "Wolf"]
    ]);
    service = new GroupingService(port);
  });

  it("warns and does nothing for an empty selection", async () => {
    await service.groupSelected([]);
    expect(port.warnings).toEqual(["NothingSelected"]);
    expect(port.calls).toEqual([]);
  });

  it("warns when no combat can be resolved", async () => {
    port.combatId = null;
    await service.groupSelected(["t1"]);
    expect(port.warnings).toEqual(["NoScene"]);
  });

  it("with no groups: creates the group first, then combatants born in it", async () => {
    await service.groupSelected(["t1", "t2", "t3"]);
    expect(port.prompts).toEqual([]);
    expect(port.calls).toEqual(["resolveCombat", "createGroup:Goblin", "createCombatants:t1,t2,t3:g1:null"]);
  });

  it("deduplicates token ids", async () => {
    await service.groupSelected(["t1", "t1"]);
    expect(port.calls).toContain("createCombatants:t1:g1:null");
  });

  it("prompts when groups exist, with a collision-free default name", async () => {
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    await service.groupSelected(["t1", "t2"]);
    expect(port.prompts).toEqual([
      { options: [{ id: "gx", name: "Goblin", color: null }], offerRemove: false, defaultName: "Goblin 2" }
    ]);
  });

  it("dismiss writes nothing", async () => {
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    port.promptResult = null;
    await service.groupSelected(["t1"]);
    expect(port.calls).toEqual(["resolveCombat"]);
  });

  it("uses the default name when the typed name is blank", async () => {
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    port.promptResult = { action: "new", name: "   " };
    await service.groupSelected(["t1"]);
    expect(port.calls).toContain("createGroup:Goblin 2");
  });

  it("joining an existing group in a started combat copies a member's initiative", async () => {
    port.started = true;
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    port.combatants = [
      { id: "old", tokenId: "t9", groupId: "gx", initiative: 12, bossEndSlot: false },
      { id: "c1", tokenId: "t1", groupId: null, initiative: 7, bossEndSlot: false }
    ];
    port.promptResult = { action: "join", groupId: "gx" };
    await service.groupSelected(["t1", "t2"]);
    expect(port.calls).toContain("assign:c1:gx:12");
    expect(port.calls).toContain("createCombatants:t2:gx:12");
    expect(port.calls.some((call) => call.startsWith("roll:"))).toBe(false);
  });

  it("a new group in a started combat rolls once and sets every member", async () => {
    port.started = true;
    port.combatants = [{ id: "c1", tokenId: "t1", groupId: null, initiative: 7, bossEndSlot: false }];
    port.rollValue = 18;
    await service.groupSelected(["t1", "t2"]);
    const roll = port.calls.indexOf("roll:g1");
    expect(roll).toBeGreaterThan(port.calls.indexOf("createCombatants:t2:g1:null"));
    expect(port.calls[roll + 1]).toMatch(/^setInitiative:c1,c\d+:18$/);
  });

  it("an unstarted combat never rolls", async () => {
    await service.groupSelected(["t1"]);
    expect(port.calls.some((call) => call.startsWith("roll:"))).toBe(false);
  });

  it("moving the last member out of a group deletes that group and tears down boss slots", async () => {
    port.groups = [{ id: "ga", name: "Wolf", color: null }];
    port.combatants = [{ id: "c3", tokenId: "t3", groupId: "ga", initiative: null, bossEndSlot: false }];
    port.promptResult = { action: "new", name: "Pack" };
    await service.groupSelected(["t3"]);
    expect(port.calls).toEqual([
      "resolveCombat",
      "createGroup:Pack",
      "assign:c3:g1:null",
      "tearDownBoss:c3",
      "deleteGroup:ga"
    ]);
  });

  it("skips combatants already in the target group", async () => {
    port.groups = [{ id: "gx", name: "Goblin", color: null }];
    port.combatants = [{ id: "c1", tokenId: "t1", groupId: "gx", initiative: null, bossEndSlot: false }];
    port.promptResult = { action: "join", groupId: "gx" };
    await service.groupSelected(["t1"]);
    expect(port.calls).toEqual(["resolveCombat"]);
  });

  it("ignores boss end slots that share the boss tokenId", async () => {
    port.combatants = [
      { id: "start", tokenId: "tb", groupId: null, initiative: 10001, bossEndSlot: false },
      { id: "end", tokenId: "tb", groupId: null, initiative: -10001, bossEndSlot: true }
    ];
    await service.groupSelected(["tb"]);
    expect(port.calls).toContain("assign:start:g1:null");
    expect(port.calls.join("|")).not.toContain("end");
  });

  it("remove: ungroups, restores boss slots, and deletes an emptied group", async () => {
    port.groups = [{ id: "ga", name: "Wolf", color: null }];
    port.combatants = [
      { id: "c3", tokenId: "t3", groupId: "ga", initiative: 9, bossEndSlot: false },
      { id: "c4", tokenId: "t4", groupId: null, initiative: 5, bossEndSlot: false }
    ];
    port.promptResult = { action: "remove" };
    await service.groupSelected(["t3", "t4"]);
    expect(port.prompts[0]?.offerRemove).toBe(true);
    expect(port.calls).toEqual(["resolveCombat", "unassign:c3", "reconcileBoss:c3", "deleteGroup:ga"]);
  });

  it("falls back to the i18n base name when no token has a name", async () => {
    port.names = new Map();
    await service.groupSelected(["t1"]);
    expect(port.calls).toContain("createGroup:Group");
  });
});
