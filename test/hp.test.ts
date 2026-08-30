import { describe, expect, it } from "vitest";
import { hpTransition } from "../src/logic/hp";

describe("hpTransition", () => {
  it("reconstructs previous HP from the post-update value and the signed delta", () => {
    // boss at 10 takes 6 damage: resulting 4, delta -6
    expect(hpTransition(4, { hp: -6, temp: 0, total: -6 })).toEqual({ previousHp: 10, newHp: 4 });
  });

  it("treats a temp-absorbed hit (no hp delta) as no HP change", () => {
    expect(hpTransition(12, { hp: 0, temp: -5, total: -5 })).toEqual({ previousHp: 12, newHp: 12 });
  });

  it("handles a killing blow to exactly zero", () => {
    expect(hpTransition(0, { hp: -7, temp: 0, total: -7 })).toEqual({ previousHp: 7, newHp: 0 });
  });
});
