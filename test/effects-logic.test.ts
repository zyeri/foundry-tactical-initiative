import { describe, expect, it } from "vitest";
import { effectChangesFor } from "../src/logic/effects";
import { ACTIVE_EFFECT_MODE_ADD, DND5E_BONUS_KEYS } from "../src/constants";

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
