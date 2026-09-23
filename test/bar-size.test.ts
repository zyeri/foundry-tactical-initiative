import { describe, expect, it } from "vitest";
import { BAR_DEFAULT, BAR_MAX, BAR_MIN, clampBarSize } from "../src/logic/bar-size";

describe("clampBarSize", () => {
  it("keeps in-range sizes and rounds to whole pixels", () => {
    expect(clampBarSize(60)).toBe(60);
    expect(clampBarSize(60.4)).toBe(60);
    expect(clampBarSize(60.5)).toBe(61);
  });
  it("clamps to the bounds", () => {
    expect(clampBarSize(10)).toBe(BAR_MIN);
    expect(clampBarSize(500)).toBe(BAR_MAX);
    expect(clampBarSize(Number.POSITIVE_INFINITY)).toBe(BAR_MAX);
    expect(clampBarSize(Number.NEGATIVE_INFINITY)).toBe(BAR_MIN);
  });
  it("falls back to the default for NaN", () => {
    expect(clampBarSize(Number.NaN)).toBe(BAR_DEFAULT);
  });
  it("exposes the agreed bounds", () => {
    expect([BAR_MIN, BAR_DEFAULT, BAR_MAX]).toEqual([32, 44, 128]);
  });
});
