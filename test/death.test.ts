import { describe, expect, it } from "vitest";
import { crossedToZero } from "../src/logic/death";

describe("crossedToZero", () => {
  it("is true only on a transition from above zero to zero or below", () => {
    expect(crossedToZero(10, 0)).toBe(true);
    expect(crossedToZero(3, -4)).toBe(true);
  });

  it("is false when the actor was already at or below zero (no re-fire on a corpse)", () => {
    expect(crossedToZero(0, 0)).toBe(false);
    expect(crossedToZero(0, -5)).toBe(false);
    expect(crossedToZero(-2, -9)).toBe(false);
  });

  it("is false when the actor stays above zero", () => {
    expect(crossedToZero(10, 4)).toBe(false);
  });
});
