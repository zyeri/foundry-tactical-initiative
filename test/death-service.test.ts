import { beforeEach, describe, expect, it } from "vitest";
import { DeathService } from "../src/death-service";
import { FakeDeathPort, type FakeActor } from "./fake-death-port";

const token = { id: "tok1", uuid: "Scene.s.Token.tok1", name: "Goblin" };

function mob(overrides: Partial<FakeActor> = {}): FakeActor {
  return {
    hp: 0,
    uuid: "Actor.gob",
    name: "Goblin",
    explicitMob: true,
    boss: false,
    tokens: [token],
    ...overrides
  };
}

function boss(overrides: Partial<FakeActor> = {}): FakeActor {
  return {
    hp: 0,
    uuid: "Actor.boss",
    name: "BIG_MAN",
    explicitMob: false,
    boss: true,
    tokens: [],
    ...overrides
  };
}

describe("DeathService.handleDamage", () => {
  let port: FakeDeathPort;
  let service: DeathService;

  beforeEach(() => {
    port = new FakeDeathPort();
    service = new DeathService(port);
  });

  it("does nothing when the actor is still alive", async () => {
    await service.handleDamage(mob({ hp: 5 }), { hp: -3, temp: 0, total: -3 });
    expect(port.hidden).toEqual([]);
    expect(port.removed).toEqual([]);
  });

  it("does nothing on overkill against a corpse (no fresh crossing)", async () => {
    await service.handleDamage(mob({ hp: 0 }), { hp: 0, temp: 0, total: 0 });
    expect(port.hidden).toEqual([]);
  });

  it("hides the token, removes the combatant, and whispers when a tagged mob in combat dies", async () => {
    port.combatByToken.set("tok1", { combatId: "c1", combatantId: "cm1" });
    await service.handleDamage(mob({ hp: 0 }), { hp: -6, temp: 0, total: -6 });
    expect(port.hidden).toEqual(["tok1"]);
    expect(port.removed).toEqual([{ combatId: "c1", combatantId: "cm1" }]);
    expect(port.whispers).toEqual([{ token, combatId: "c1" }]);
  });

  it("leaves an out-of-combat mob alone (no combatant, no hide)", async () => {
    await service.handleDamage(mob({ hp: 0 }), { hp: -6, temp: 0, total: -6 });
    expect(port.hidden).toEqual([]);
    expect(port.whispers).toEqual([]);
  });

  it("does not remove a creature that is not an explicit mob", async () => {
    port.combatByToken.set("tok1", { combatId: "c1", combatantId: "cm1" });
    await service.handleDamage(mob({ hp: 0, explicitMob: false }), { hp: -6, temp: 0, total: -6 });
    expect(port.removed).toEqual([]);
  });

  it("posts an attributed public callout when a boss dies with a recent hit on it", async () => {
    port.nowValue = 1000;
    service.recordDamage({
      attackerName: "Richard",
      attackerActorId: "rich",
      itemName: "GUN",
      targetUuids: ["Actor.boss"],
      timestamp: 1000
    });
    await service.handleDamage(boss({ hp: 0 }), { hp: -8, temp: 0, total: -8 });
    expect(port.posted).toEqual([
      'TACTICAL_INITIATIVE.Chat.BossKilled|{"killer":"Richard","boss":"BIG_MAN","weapon":"GUN"}'
    ]);
  });

  it("posts the plain fallback when a boss dies with no attributable source", async () => {
    await service.handleDamage(boss({ hp: 0 }), { hp: -8, temp: 0, total: -8 });
    expect(port.posted).toEqual(['TACTICAL_INITIATIVE.Chat.BossDied|{"boss":"BIG_MAN"}']);
  });

  it("posts nothing when boss-death announcements are disabled", async () => {
    port.announce = false;
    await service.handleDamage(boss({ hp: 0 }), { hp: -8, temp: 0, total: -8 });
    expect(port.posted).toEqual([]);
  });
});

describe("DeathService.recordDamage", () => {
  it("ignores a null parse result", () => {
    const service = new DeathService(new FakeDeathPort());
    service.recordDamage(null);
    expect(service.getLastSource()).toBeNull();
  });
});

describe("DeathService.restoreMob", () => {
  let port: FakeDeathPort;
  let service: DeathService;

  beforeEach(() => {
    port = new FakeDeathPort();
    service = new DeathService(port);
    port.tokensByUuid.set(token.uuid, token);
  });

  it("un-hides the token and re-adds it when the combat still exists", async () => {
    port.existingCombats.add("c1");
    await service.restoreMob(token.uuid, "c1");
    expect(port.unhidden).toEqual(["tok1"]);
    expect(port.added).toEqual([{ combatId: "c1", tokenId: "tok1" }]);
  });

  it("un-hides but warns and does not re-add when the combat is gone", async () => {
    await service.restoreMob(token.uuid, "c1");
    expect(port.unhidden).toEqual(["tok1"]);
    expect(port.added).toEqual([]);
    expect(port.warnedNoCombat).toBe(1);
  });

  it("does not duplicate a combatant that already exists", async () => {
    port.existingCombats.add("c1");
    port.combatTokens.add("c1:tok1");
    await service.restoreMob(token.uuid, "c1");
    expect(port.added).toEqual([]);
  });

  it("does nothing when the token uuid cannot be resolved", async () => {
    await service.restoreMob("Scene.s.Token.gone", "c1");
    expect(port.unhidden).toEqual([]);
  });
});
