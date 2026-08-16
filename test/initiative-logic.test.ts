import { describe, expect, it } from "vitest";
import { initiativeAdjustment, normalizeChoice } from "../src/logic/initiative";

describe("initiativeAdjustment", () => {
  it("adds 3 for rush", () => {
    expect(initiativeAdjustment("rush")).toBe(3);
  });
  it("adds nothing for march", () => {
    expect(initiativeAdjustment("march")).toBe(0);
  });
  it("subtracts 6 for hunker", () => {
    expect(initiativeAdjustment("hunker")).toBe(-6);
  });
});

describe("normalizeChoice", () => {
  it("passes valid choices through unchanged", () => {
    expect(normalizeChoice("rush")).toBe("rush");
    expect(normalizeChoice("march")).toBe("march");
    expect(normalizeChoice("hunker")).toBe("hunker");
  });
  it("falls back to march for invalid or missing values", () => {
    expect(normalizeChoice(undefined)).toBe("march");
    expect(normalizeChoice(null)).toBe("march");
    expect(normalizeChoice("nonsense")).toBe("march");
    expect(normalizeChoice(42)).toBe("march");
  });
});
