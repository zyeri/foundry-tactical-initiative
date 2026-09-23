import { describe, expect, it } from "vitest";
import { findLeftovers, type LeftoverCandidate } from "../src/logic/leftovers";

function cand(over: Partial<LeftoverCandidate> & { combatantId: string }): LeftoverCandidate {
  return {
    combatId: over.combatId ?? "c1",
    combatantId: over.combatantId,
    name: over.name ?? over.combatantId,
    sceneId: over.sceneId === undefined ? "s1" : over.sceneId,
    tokenId: over.tokenId === undefined ? "t1" : over.tokenId
  };
}

const gone = (): boolean => false;
const present = (): boolean => true;

describe("findLeftovers", () => {
  it("reports a combatant whose deleted token no longer exists", () => {
    const result = findLeftovers([cand({ combatantId: "a" })], [{ sceneId: "s1", tokenId: "t1" }], gone);
    expect(result).toEqual([{ combatId: "c1", combatantId: "a", name: "a" }]);
  });

  it("a combatant whose token still exists is never a leftover", () => {
    expect(findLeftovers([cand({ combatantId: "a" })], [{ sceneId: "s1", tokenId: "t1" }], present)).toEqual([]);
  });

  it("reports a surviving boss end slot that shares the deleted tokenId", () => {
    const result = findLeftovers(
      [cand({ combatantId: "start", name: "Ogre" }), cand({ combatantId: "end", name: "Ogre" })],
      [{ sceneId: "s1", tokenId: "t1" }],
      gone
    );
    expect(result.map((r) => r.combatantId)).toEqual(["start", "end"]);
  });

  it("covers the same token in two combats, in input order", () => {
    const result = findLeftovers(
      [cand({ combatantId: "x", combatId: "c1" }), cand({ combatantId: "y", combatId: "c2" })],
      [{ sceneId: "s1", tokenId: "t1" }],
      gone
    );
    expect(result).toEqual([
      { combatId: "c1", combatantId: "x", name: "x" },
      { combatId: "c2", combatantId: "y", name: "y" }
    ]);
  });

  it("ignores other scenes, other tokens, and combatants without a token", () => {
    const result = findLeftovers(
      [
        cand({ combatantId: "other-scene", sceneId: "s2" }),
        cand({ combatantId: "other-token", tokenId: "t9" }),
        cand({ combatantId: "no-token", tokenId: null }),
        cand({ combatantId: "no-scene", sceneId: null })
      ],
      [{ sceneId: "s1", tokenId: "t1" }],
      gone
    );
    expect(result).toEqual([]);
  });

  it("deduplicates repeated deletions and repeated candidates", () => {
    const result = findLeftovers(
      [cand({ combatantId: "a" }), cand({ combatantId: "a" })],
      [
        { sceneId: "s1", tokenId: "t1" },
        { sceneId: "s1", tokenId: "t1" }
      ],
      gone
    );
    expect(result).toHaveLength(1);
  });

  it("returns nothing for an empty queue", () => {
    expect(findLeftovers([cand({ combatantId: "a" })], [], gone)).toEqual([]);
  });
});
