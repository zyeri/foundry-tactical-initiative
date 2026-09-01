import { beforeEach, describe, expect, it } from "vitest";
import { GroupControlService, type GroupMemberRef } from "../src/group-control-service";
import { FakeGroupControlPort } from "./fake-group-control-port";

const members: GroupMemberRef[] = [
  { combatantId: "c1", tokenId: "t1", actorId: "a1", name: "Gob 1" },
  { combatantId: "c2", tokenId: "t2", actorId: "a2", name: "Gob 2" },
  { combatantId: "c3", tokenId: null, actorId: "a3", name: "Gob 3" }
];

describe("GroupControlService", () => {
  let port: FakeGroupControlPort;
  let service: GroupControlService;

  beforeEach(() => {
    port = new FakeGroupControlPort();
    port.membersByGroup.set("g", members);
    service = new GroupControlService(port);
  });

  it("selects every member token, skipping members with no token", async () => {
    await service.selectAll("g");
    expect(port.selected).toEqual([["t1", "t2"]]);
  });

  it("targets every member token", async () => {
    await service.targetAll("g");
    expect(port.targeted).toEqual([["t1", "t2"]]);
  });

  it("applies damage/healing to every member actor", async () => {
    await service.applyToAll("g", { amount: 5, isHealing: false });
    expect(port.damaged.map((d) => d.actorId)).toEqual(["a1", "a2", "a3"]);
    expect(port.damaged[0]?.input.amount).toBe(5);
  });

  it("toggles a condition on every member", async () => {
    await service.setConditionAll("g", "prone", true);
    expect(port.conditions.map((c) => c.member.combatantId)).toEqual(["c1", "c2", "c3"]);
    expect(port.conditions.every((c) => c.statusId === "prone" && c.active)).toBe(true);
  });

  it("no-ops on an empty or unknown group", async () => {
    await service.selectAll("missing");
    await service.applyToAll("missing", { amount: 5 });
    expect(port.selected).toEqual([[]]);
    expect(port.damaged).toEqual([]);
  });
});
