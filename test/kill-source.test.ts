import {
  isSelfHit,
  nextSource,
  parseDamageCard,
  selectAttribution,
  type Source
} from "../src/logic/kill-source";

import { describe, expect, it } from "vitest";

const evt = {
  attackerName: "Richard",
  attackerActorId: "rich",
  itemName: "GUN",
  targetUuids: ["Actor.boss"],
  timestamp: 1000
};

describe("nextSource", () => {
  it("records a real damage event that has at least one non-self target", () => {
    expect(nextSource(null, evt)).toEqual(evt);
  });

  it("ignores an event with no targets", () => {
    const prev: Source = { ...evt };
    expect(nextSource(prev, { ...evt, targetUuids: [] })).toBe(prev);
  });

  it("ignores a self-hit (attacker is among its own targets)", () => {
    const prev: Source = { ...evt };
    expect(nextSource(prev, { ...evt, targetUuids: ["Actor.rich"] })).toBe(prev);
  });

  it("ignores a self-hit for an unlinked synthetic target uuid", () => {
    const prev: Source = { ...evt };
    expect(nextSource(prev, { ...evt, targetUuids: ["Scene.s.Token.t.Actor.rich"] })).toBe(prev);
  });

  it("ignores an event with an empty attacker name", () => {
    const prev: Source = { ...evt };
    expect(nextSource(prev, { ...evt, attackerName: "" })).toBe(prev);
  });

  it("replaces the prior source with a newer real damage event", () => {
    const prev: Source = { ...evt };
    const newer = { ...evt, attackerName: "Vasquez", timestamp: 2000 };
    expect(nextSource(prev, newer)).toEqual(newer);
  });
});

describe("isSelfHit", () => {
  it("matches a bare linked target uuid", () => {
    expect(isSelfHit("a1", ["Actor.a1"])).toBe(true);
  });

  it("matches an unlinked synthetic target uuid by its actor-id suffix", () => {
    expect(isSelfHit("a1", ["Scene.s.Token.t.Actor.a1"])).toBe(true);
  });

  it("does not match a different actor", () => {
    expect(isSelfHit("a1", ["Actor.a2", "Scene.s.Token.t.Actor.a3"])).toBe(false);
  });

  it("is false with an empty attacker id", () => {
    expect(isSelfHit("", ["Actor.a1"])).toBe(false);
  });
});

describe("parseDamageCard", () => {
  const resolveItemName = (uuid: string): string | null => (uuid === "Item.gun" ? "GUN" : null);

  const damageCard = {
    flags: {
      dnd5e: {
        roll: { type: "damage" },
        item: { uuid: "Item.gun" },
        targets: [{ uuid: "Actor.boss" }]
      }
    },
    speaker: { actor: "rich", alias: "Richard" }
  };

  it("parses a damage card into a DamageEvent", () => {
    expect(parseDamageCard(damageCard, 1000, resolveItemName)).toEqual({
      attackerName: "Richard",
      attackerActorId: "rich",
      itemName: "GUN",
      targetUuids: ["Actor.boss"],
      timestamp: 1000
    });
  });

  it("returns null for a non-damage card", () => {
    const attack = { ...damageCard, flags: { dnd5e: { ...damageCard.flags.dnd5e, roll: { type: "attack" } } } };
    expect(parseDamageCard(attack, 1000, resolveItemName)).toBeNull();
  });

  it("returns null when there are no targets", () => {
    const noTargets = { ...damageCard, flags: { dnd5e: { ...damageCard.flags.dnd5e, targets: [] } } };
    expect(parseDamageCard(noTargets, 1000, resolveItemName)).toBeNull();
  });

  it("falls back to the renamed `actor` target field when `uuid` is absent", () => {
    const renamed = {
      ...damageCard,
      flags: { dnd5e: { ...damageCard.flags.dnd5e, targets: [{ actor: "Actor.boss" }] } }
    };
    expect(parseDamageCard(renamed, 1000, resolveItemName)?.targetUuids).toEqual(["Actor.boss"]);
  });

  it("yields a null item name when the item cannot be resolved", () => {
    const noItem = { ...damageCard, flags: { dnd5e: { ...damageCard.flags.dnd5e, item: { uuid: "Item.missing" } } } };
    expect(parseDamageCard(noItem, 1000, resolveItemName)?.itemName).toBeNull();
  });
});

describe("selectAttribution", () => {
  const src: Source = { ...evt };

  it("returns attacker + item when the dead actor is a target and within the window", () => {
    expect(selectAttribution(src, "Actor.boss", 20000, 45000)).toEqual({
      attackerName: "Richard",
      itemName: "GUN"
    });
  });

  it("returns null when the dead actor was not a target", () => {
    expect(selectAttribution(src, "Actor.other", 20000, 45000)).toBeNull();
  });

  it("returns null when the source is older than the window", () => {
    expect(selectAttribution(src, "Actor.boss", 60000, 45000)).toBeNull();
  });

  it("attributes at exactly the window edge (now - timestamp == windowMs)", () => {
    // timestamp 1000, window 45000 -> edge at now = 46000
    expect(selectAttribution(src, "Actor.boss", 46000, 45000)).toEqual({
      attackerName: "Richard",
      itemName: "GUN"
    });
  });

  it("drops attribution one ms past the window", () => {
    expect(selectAttribution(src, "Actor.boss", 46001, 45000)).toBeNull();
  });

  it("returns null for a missing source", () => {
    expect(selectAttribution(null, "Actor.boss", 1000, 45000)).toBeNull();
  });
});
