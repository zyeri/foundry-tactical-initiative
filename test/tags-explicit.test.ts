import { describe, expect, it } from "vitest";
import { isExplicitlyTagged } from "../src/adapter/tags";

/** Minimal actor stub exposing only getFlag, cast to the ambient FoundryActor. */
function actorWithFlag(stored: unknown): any {
  return { getFlag: (_scope: string, _key: string) => stored };
}

describe("isExplicitlyTagged", () => {
  it("is true only when the stored tag exactly matches", () => {
    expect(isExplicitlyTagged(actorWithFlag("mob"), "mob")).toBe(true);
  });

  it("is false when the tag is unset (defaulted, not explicit)", () => {
    expect(isExplicitlyTagged(actorWithFlag(undefined), "mob")).toBe(false);
    expect(isExplicitlyTagged(actorWithFlag(null), "mob")).toBe(false);
  });

  it("is false when a different tag is stored", () => {
    expect(isExplicitlyTagged(actorWithFlag("boss"), "mob")).toBe(false);
  });
});
