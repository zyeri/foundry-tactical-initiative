import { describe, expect, it } from "vitest";
import { effectChangesFor, toV14Changes } from "../src/logic/effects";
import { ACTIVE_EFFECT_MODE_ADD, ACTIVE_EFFECT_TYPE_ADD, DND5E_BONUS_KEYS } from "../src/constants";

describe("effectChangesFor", () => {
  it("returns no changes for march", () => {
    expect(effectChangesFor("march")).toEqual([]);
  });

  it("applies -1 to every dnd5e bonus key for rush", () => {
    const changes = effectChangesFor("rush");
    expect(changes).toHaveLength(DND5E_BONUS_KEYS.length);
    for (const change of changes) {
      expect(change.value).toBe("-1");
      expect(change.mode).toBe(ACTIVE_EFFECT_MODE_ADD);
    }
    expect(changes.map((c) => c.key)).toEqual([...DND5E_BONUS_KEYS]);
  });

  it("applies +2 to every dnd5e bonus key for hunker", () => {
    const changes = effectChangesFor("hunker");
    expect(changes).toHaveLength(DND5E_BONUS_KEYS.length);
    for (const change of changes) {
      expect(change.value).toBe("+2");
      expect(change.mode).toBe(ACTIVE_EFFECT_MODE_ADD);
    }
  });
});

describe("toV14Changes", () => {
  it("maps an empty list to an empty list", () => {
    expect(toV14Changes([])).toEqual([]);
  });

  it("replaces numeric mode with string type and preserves key/value/priority", () => {
    const v14 = toV14Changes(effectChangesFor("rush"));
    expect(v14).toHaveLength(DND5E_BONUS_KEYS.length);
    for (const change of v14) {
      expect(change.type).toBe(ACTIVE_EFFECT_TYPE_ADD);
      expect(change.value).toBe("-1");
      expect(change.priority).toBe(20);
      expect(change).not.toHaveProperty("mode");
    }
    expect(v14.map((c) => c.key)).toEqual([...DND5E_BONUS_KEYS]);
  });
});
