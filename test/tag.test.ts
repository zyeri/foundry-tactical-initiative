import { describe, expect, it } from "vitest";
import { resolveTag } from "../src/logic/tag";

describe("resolveTag", () => {
  it("returns the stored tag when it is valid", () => {
    expect(resolveTag("npc", "boss")).toBe("boss");
    expect(resolveTag("character", "mob")).toBe("mob");
  });

  it("defaults character actors to player when unset", () => {
    expect(resolveTag("character", null)).toBe("player");
    expect(resolveTag("character", undefined)).toBe("player");
  });

  it("defaults non-character actors to mob when unset", () => {
    expect(resolveTag("npc", undefined)).toBe("mob");
    expect(resolveTag("vehicle", null)).toBe("mob");
  });

  it("ignores an invalid stored tag and falls back by actor type", () => {
    expect(resolveTag("character", "garbage")).toBe("player");
    expect(resolveTag("npc", "")).toBe("mob");
  });
});
