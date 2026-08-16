import { describe, expect, it } from "vitest";
import { TacticalInitiative } from "../src/service";
import { FakePort, makeCombatant } from "./fake-port";

const COMBAT = "combat-1";

describe("TacticalInitiative.rollForCombat", () => {
  it("rolls a mob normally and applies no effect or dialog", async () => {
    const port = new FakePort([makeCombatant({ id: "m1", tag: "mob", rollValue: 15 })]);
    await new TacticalInitiative(port).rollForCombat(COMBAT);

    expect(port.initiatives.get("m1")).toBe(15);
    expect(port.firstIndexOf("requestPlayerChoice")).toBe(-1);
    expect(port.firstIndexOf("applyEffect")).toBe(-1);
  });

  it("assigns boss start/end fixed initiatives without rolling", async () => {
    const port = new FakePort([
      makeCombatant({ id: "b-start", tag: "boss", bossSlot: "start", bossRank: 0 }),
      makeCombatant({ id: "b-end", tag: "boss", bossSlot: "end", bossRank: 0 })
    ]);
    await new TacticalInitiative(port).rollForCombat(COMBAT);

    expect(port.initiatives.get("b-start")).toBe(10000);
    expect(port.initiatives.get("b-end")).toBe(-10000);
    expect(port.firstIndexOf("rollInitiativeValue")).toBe(-1);
  });

  it("keeps multiple bosses in the same order at start and end", async () => {
    const port = new FakePort([
      makeCombatant({ id: "a-start", tag: "boss", bossSlot: "start", bossRank: 0 }),
      makeCombatant({ id: "b-start", tag: "boss", bossSlot: "start", bossRank: 1 }),
      makeCombatant({ id: "a-end", tag: "boss", bossSlot: "end", bossRank: 0 }),
      makeCombatant({ id: "b-end", tag: "boss", bossSlot: "end", bossRank: 1 })
    ]);
    await new TacticalInitiative(port).rollForCombat(COMBAT);

    const aStart = port.initiatives.get("a-start")!;
    const bStart = port.initiatives.get("b-start")!;
    const aEnd = port.initiatives.get("a-end")!;
    const bEnd = port.initiatives.get("b-end")!;
    expect(aStart).toBeGreaterThan(bStart); // A before B at start
    expect(aEnd).toBeGreaterThan(bEnd); // A before B at end too
  });

  it("applies the rush effect and adds +3 to the player's roll", async () => {
    const port = new FakePort([
      makeCombatant({ id: "p1", tag: "player", rollValue: 12, choiceResult: "rush" })
    ]);
    await new TacticalInitiative(port).rollForCombat(COMBAT);

    expect(port.effects.get("p1-actor")).toBe("rush");
    expect(port.initiatives.get("p1")).toBe(15);
  });

  it("applies the hunker effect and subtracts 6 from the player's roll", async () => {
    const port = new FakePort([
      makeCombatant({ id: "p1", tag: "player", rollValue: 12, choiceResult: "hunker" })
    ]);
    await new TacticalInitiative(port).rollForCombat(COMBAT);

    expect(port.effects.get("p1-actor")).toBe("hunker");
    expect(port.initiatives.get("p1")).toBe(6);
  });

  it("defaults an offline player to March with a chat note and no effect", async () => {
    const port = new FakePort([
      makeCombatant({ id: "p1", tag: "player", rollValue: 12, choiceResult: null })
    ]);
    await new TacticalInitiative(port).rollForCombat(COMBAT);

    expect(port.announced).toContain("p1-name");
    expect(port.effects.has("p1-actor")).toBe(false);
    expect(port.initiatives.get("p1")).toBe(12);
  });

  it("removes temp effects and clears initiative for every combatant before any roll", async () => {
    const port = new FakePort([
      makeCombatant({ id: "m1", tag: "mob", rollValue: 9 }),
      makeCombatant({ id: "p1", tag: "player", rollValue: 12, choiceResult: "march" })
    ]);
    await new TacticalInitiative(port).rollForCombat(COMBAT);

    const lastReset = Math.max(port.lastIndexOf("removeTempEffects"), port.lastIndexOf("clearInitiative"));
    const firstRoll = Math.min(
      port.firstIndexOf("rollInitiativeValue"),
      port.firstIndexOf("setInitiative")
    );
    expect(lastReset).toBeLessThan(firstRoll);
    expect(port.removedEffects).toContain("m1-actor");
    expect(port.removedEffects).toContain("p1-actor");
  });

  it("resets a defeated combatant but does not roll or set its initiative", async () => {
    const port = new FakePort([
      makeCombatant({ id: "dead", tag: "mob", rollValue: 20, isDefeated: true })
    ]);
    await new TacticalInitiative(port).rollForCombat(COMBAT);

    expect(port.initiatives.get("dead")).toBe(null); // cleared, never set
    expect(port.firstIndexOf("setInitiative")).toBe(-1);
  });

  it("toggles the choosing indicator on then off around a player", async () => {
    const port = new FakePort([
      makeCombatant({ id: "p1", tag: "player", rollValue: 12, choiceResult: "march" })
    ]);
    await new TacticalInitiative(port).rollForCombat(COMBAT);

    expect(port.choosing).toEqual([
      { id: "p1", choosing: true },
      { id: "p1", choosing: false }
    ]);
  });
});

describe("TacticalInitiative.rollForCombatant", () => {
  it("rolls only the named combatant and leaves the others untouched", async () => {
    const port = new FakePort([
      makeCombatant({ id: "m1", tag: "mob", rollValue: 15 }),
      makeCombatant({ id: "m2", tag: "mob", rollValue: 8 })
    ]);
    await new TacticalInitiative(port).rollForCombatant(COMBAT, "m2");

    expect(port.initiatives.get("m2")).toBe(8);
    expect(port.initiatives.has("m1")).toBe(false);
  });

  it("skips a defeated joiner", async () => {
    const port = new FakePort([
      makeCombatant({ id: "dead", tag: "mob", rollValue: 20, isDefeated: true })
    ]);
    await new TacticalInitiative(port).rollForCombatant(COMBAT, "dead");

    expect(port.firstIndexOf("setInitiative")).toBe(-1);
  });
});
