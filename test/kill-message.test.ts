import { describe, expect, it } from "vitest";
import { killMessageKey } from "../src/logic/kill-message";

describe("killMessageKey", () => {
  it("credits killer and weapon when both are known", () => {
    expect(killMessageKey("BIG_MAN", { attackerName: "Richard", itemName: "GUN" })).toEqual({
      key: "TACTICAL_INITIATIVE.Chat.BossKilled",
      data: { killer: "Richard", boss: "BIG_MAN", weapon: "GUN" }
    });
  });

  it("credits killer without a weapon when the item is unknown", () => {
    expect(killMessageKey("BIG_MAN", { attackerName: "Richard", itemName: null })).toEqual({
      key: "TACTICAL_INITIATIVE.Chat.BossKilledNoWeapon",
      data: { killer: "Richard", boss: "BIG_MAN" }
    });
  });

  it("falls back to a plain death line with no attribution", () => {
    expect(killMessageKey("BIG_MAN", null)).toEqual({
      key: "TACTICAL_INITIATIVE.Chat.BossDied",
      data: { boss: "BIG_MAN" }
    });
  });
});
