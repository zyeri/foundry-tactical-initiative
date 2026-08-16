import { describe, expect, it } from "vitest";
import { bossSlotInitiative } from "../src/logic/boss";

describe("bossSlotInitiative", () => {
  it("uses the base values at rank 0", () => {
    expect(bossSlotInitiative("start", 0)).toBe(10000);
    expect(bossSlotInitiative("end", 0)).toBe(-10000);
  });

  it("sorts every start slot above any plausible d20 roll", () => {
    for (let rank = 0; rank < 100; rank++) {
      expect(bossSlotInitiative("start", rank)).toBeGreaterThan(1000);
    }
  });

  it("sorts every end slot below any plausible d20 roll", () => {
    for (let rank = 0; rank < 100; rank++) {
      expect(bossSlotInitiative("end", rank)).toBeLessThan(-1000);
    }
  });

  it("preserves relative boss order at both ends (lower rank sorts first)", () => {
    // Foundry sorts initiative descending, so "sorts first" == higher value.
    expect(bossSlotInitiative("start", 0)).toBeGreaterThan(bossSlotInitiative("start", 1));
    expect(bossSlotInitiative("end", 0)).toBeGreaterThan(bossSlotInitiative("end", 1));
  });
});
