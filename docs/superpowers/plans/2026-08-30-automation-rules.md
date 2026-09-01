# Automation Rules (F4 + F5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two GM-side combat automations to the Tactical Initiative module - remove+hide an explicitly-tagged `mob` when it hits 0 HP (with a GM undo), and post a public, attributed chat callout when a `boss` hits 0 HP.

**Architecture:** New pure-logic units (HP transition, death crossing, kill-source reducer, kill-message selector) are TDD'd under vitest. A new `combat-events.ts` adapter watches `dnd5e.damageActor` (death detection) and `createChatMessage` (attribution capture) on the elected active GM, detects a death once, and dispatches to F4/F5 subscribers. The adapter layer follows the module's existing convention: not unit-tested, covered by a manual checklist.

**Tech Stack:** TypeScript (strictest tsconfig), vitest, esbuild, FoundryVTT v14 + dnd5e 5.3 runtime.

**Spec:** `docs/superpowers/specs/2026-08-30-automation-rules-design.md`

> **Execution deviation (2026-08-30):** To satisfy strict TDD, Tasks 7-9 were
> restructured from a single Foundry-coupled `combat-events.ts` into a testable seam:
> a pure `parseDamageCard` (Task 7), a `DeathService` + `DeathPort` orchestration
> unit-tested against `test/fake-death-port.ts` (Task 8, holds all F4/F5 decisions),
> and a thin `combat-events.ts` = real `FoundryDeathPort` + hook wiring (Task 9, the
> only untested Foundry boundary, manual-checklist). All pure logic below is unchanged
> and was implemented test-first. Final: 75 unit tests green, `npm run check` clean.

## Global Constraints

- FoundryVTT **v14** + **dnd5e 5.3+** only. Raise `module.json` `compatibility.minimum` to `"14"`.
- All world mutation runs on the elected active GM only, via the existing `isActiveGM()` guard.
- ASCII-only text, no emoji, in every authored file.
- Full JSDoc on every exported symbol (matches existing `src/logic/*`).
- No placeholders or stubs in shipped code.
- `dnd5e.damageActor(actor, changes, update, userId)`: `changes.{hp,temp,total}` are signed DELTAS; the hook fires post-update and on EVERY client (guard with `isActiveGM`).
- Attribution matches by actor **UUID**, never id (dnd5e target descriptors are UUIDs).
- Commits require the user's explicit per-commit approval; never add AI-authorship trailers.

---

### Task 1: Settings + constants + i18n keys

**Files:**
- Modify: `src/constants.ts` (extend `SETTINGS`, add `DEFAULT_KILL_WINDOW_SECONDS`)
- Modify: `src/settings.ts` (register two settings, add two accessors)
- Modify: `lang/en.json` (new keys)

**Interfaces:**
- Produces: `SETTINGS.ANNOUNCE_BOSS_DEATH`, `SETTINGS.KILL_WINDOW`, `DEFAULT_KILL_WINDOW_SECONDS`; `getAnnounceBossDeath(): boolean`; `getKillWindowMs(): number`.

- [ ] **Step 1: Extend the SETTINGS constant**

In `src/constants.ts`, replace the `SETTINGS` object:

```ts
/** Module setting keys. */
export const SETTINGS = {
  /** World setting: seconds to wait for a player's choice before defaulting to March. */
  PLAYER_TIMEOUT: "playerTimeoutSeconds",
  /** World setting: whether a boss death posts a public chat callout. */
  ANNOUNCE_BOSS_DEATH: "announceBossDeath",
  /** World setting: seconds a recorded damage source stays valid for kill attribution. */
  KILL_WINDOW: "killAttributionWindowSeconds"
} as const;

/** Default staleness window (seconds) for F5 kill attribution. */
export const DEFAULT_KILL_WINDOW_SECONDS = 45 as const;
```

- [ ] **Step 2: Register the two settings and add accessors**

In `src/settings.ts`, add to `registerSettings()` (after the existing register call):

```ts
  game.settings.register(MODULE_ID, SETTINGS.ANNOUNCE_BOSS_DEATH, {
    name: "TACTICAL_INITIATIVE.Settings.AnnounceBossDeath.Name",
    hint: "TACTICAL_INITIATIVE.Settings.AnnounceBossDeath.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.KILL_WINDOW, {
    name: "TACTICAL_INITIATIVE.Settings.KillAttributionWindow.Name",
    hint: "TACTICAL_INITIATIVE.Settings.KillAttributionWindow.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_KILL_WINDOW_SECONDS,
    range: { min: 5, max: 300, step: 5 }
  });
```

Update the import line to include the new constants:

```ts
import { DEFAULT_KILL_WINDOW_SECONDS, MODULE_ID, SETTINGS } from "./constants";
```

Add the two accessors at the end of the file:

```ts
/**
 * Whether a boss death should post a public chat callout.
 *
 * @returns The `announceBossDeath` world setting (defaults to `true`).
 */
export function getAnnounceBossDeath(): boolean {
  const raw = game.settings.get(MODULE_ID, SETTINGS.ANNOUNCE_BOSS_DEATH);
  return raw !== false;
}

/**
 * The kill-attribution staleness window, in milliseconds (minimum 5s).
 *
 * @returns The window in milliseconds.
 */
export function getKillWindowMs(): number {
  const raw = game.settings.get(MODULE_ID, SETTINGS.KILL_WINDOW);
  const seconds =
    typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_KILL_WINDOW_SECONDS;
  return Math.max(5, seconds) * 1000;
}
```

- [ ] **Step 3: Add the i18n keys**

In `lang/en.json`, add before the closing brace (append a comma to the current last entry):

```json
  "TACTICAL_INITIATIVE.Settings.AnnounceBossDeath.Name": "Announce boss deaths in chat",
  "TACTICAL_INITIATIVE.Settings.AnnounceBossDeath.Hint": "Post a public chat message when a Boss-tagged creature reaches 0 HP.",
  "TACTICAL_INITIATIVE.Settings.KillAttributionWindow.Name": "Kill attribution window (seconds)",
  "TACTICAL_INITIATIVE.Settings.KillAttributionWindow.Hint": "How recent a damaging hit must be to credit the killer in a boss-death message.",
  "TACTICAL_INITIATIVE.Chat.BossKilled": "{killer} has killed {boss} with their {weapon}!",
  "TACTICAL_INITIATIVE.Chat.BossKilledNoWeapon": "{killer} has killed {boss}!",
  "TACTICAL_INITIATIVE.Chat.BossDied": "{boss} has fallen!",
  "TACTICAL_INITIATIVE.Chat.RestoreMob": "Restore {name} to combat",
  "TACTICAL_INITIATIVE.Chat.RestoreNoCombat": "That combat no longer exists; the token was un-hidden but not re-added."
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts src/settings.ts lang/en.json
git commit -m "feat: add boss-death and kill-window settings + chat i18n keys"
```

---

### Task 2: `hp.ts` - HP transition (pure, TDD)

**Files:**
- Create: `src/logic/hp.ts`
- Test: `test/hp.test.ts`

**Interfaces:**
- Produces: `interface HpChanges { hp: number; temp: number; total: number }`; `interface HpTransition { previousHp: number; newHp: number }`; `hpTransition(resultingHp: number, changes: HpChanges): HpTransition`.

- [ ] **Step 1: Write the failing test**

Create `test/hp.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hp.test.ts`
Expected: FAIL ("Cannot find module '../src/logic/hp'").

- [ ] **Step 3: Write minimal implementation**

Create `src/logic/hp.ts`:

```ts
/**
 * @file Pure HP-transition arithmetic for the dnd5e `damageActor` hook, which
 * reports signed deltas and fires after the update is applied. No Foundry globals.
 */

/** The `changes` payload of `dnd5e.damageActor`: signed deltas, not resulting values. */
export interface HpChanges {
  /** Signed change to hit points (negative on damage). */
  hp: number;
  /** Signed change to temporary hit points. */
  temp: number;
  /** Summed signed change to hit points. */
  total: number;
}

/** A before/after pair of hit-point values. */
export interface HpTransition {
  /** Hit points immediately before this change. */
  previousHp: number;
  /** Hit points immediately after this change. */
  newHp: number;
}

/**
 * Reconstruct the before/after hit points from the post-update value and the
 * signed delta the `dnd5e.damageActor` hook reports.
 *
 * @param resultingHp - The actor's hit points after the update (already applied).
 * @param changes - The hook's signed-delta payload.
 * @returns The previous and new hit points.
 */
export function hpTransition(resultingHp: number, changes: HpChanges): HpTransition {
  return { previousHp: resultingHp - changes.hp, newHp: resultingHp };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/hp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/hp.ts test/hp.test.ts
git commit -m "feat: add pure hpTransition delta arithmetic"
```

---

### Task 3: `death.ts` - zero-crossing (pure, TDD)

**Files:**
- Create: `src/logic/death.ts`
- Test: `test/death.test.ts`

**Interfaces:**
- Produces: `crossedToZero(previousHp: number, newHp: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `test/death.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/death.test.ts`
Expected: FAIL ("Cannot find module '../src/logic/death'").

- [ ] **Step 3: Write minimal implementation**

Create `src/logic/death.ts`:

```ts
/**
 * @file Pure death-detection predicate. No Foundry globals, no side effects.
 */

/**
 * Whether a hit-point change crossed an actor from alive to dropped.
 *
 * @param previousHp - Hit points before the change.
 * @param newHp - Hit points after the change.
 * @returns `true` only for a transition from above 0 to 0 or below.
 */
export function crossedToZero(previousHp: number, newHp: number): boolean {
  return previousHp > 0 && newHp <= 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/death.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/death.ts test/death.test.ts
git commit -m "feat: add pure crossedToZero death predicate"
```

---

### Task 4: `kill-source.ts` - attribution reducer + selector (pure, TDD)

**Files:**
- Create: `src/logic/kill-source.ts`
- Test: `test/kill-source.test.ts`

**Interfaces:**
- Produces: `interface DamageEvent`, `interface Source`, `interface Attribution`; `nextSource(prev: Source | null, event: DamageEvent): Source | null`; `selectAttribution(source: Source | null, deadActorUuid: string, now: number, windowMs: number): Attribution | null`; `isSelfHit(attackerActorId: string, targetUuids: string[]): boolean`.

- [ ] **Step 1: Write the failing test**

Create `test/kill-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isSelfHit,
  nextSource,
  selectAttribution,
  type Source
} from "../src/logic/kill-source";

const evt = {
  attackerName: "Richard",
  attackerActorId: "rich",
  itemName: "GUN",
  targetUuids: ["Actor.boss"],
  timestamp: 1000
};

describe("nextSource", () => {
  it("records a real damage event that has at least one non-self target", () => {
    expect(nextSource(null, evt)).toEqual(evt);
  });

  it("ignores an event with no targets", () => {
    const prev: Source = { ...evt };
    expect(nextSource(prev, { ...evt, targetUuids: [] })).toBe(prev);
  });

  it("ignores a self-hit (attacker is among its own targets)", () => {
    const prev: Source = { ...evt };
    expect(nextSource(prev, { ...evt, targetUuids: ["Actor.rich"] })).toBe(prev);
  });

  it("ignores a self-hit for an unlinked synthetic target uuid", () => {
    const prev: Source = { ...evt };
    expect(nextSource(prev, { ...evt, targetUuids: ["Scene.s.Token.t.Actor.rich"] })).toBe(prev);
  });

  it("ignores an event with an empty attacker name", () => {
    const prev: Source = { ...evt };
    expect(nextSource(prev, { ...evt, attackerName: "" })).toBe(prev);
  });

  it("replaces the prior source with a newer real damage event", () => {
    const prev: Source = { ...evt };
    const newer = { ...evt, attackerName: "Vasquez", timestamp: 2000 };
    expect(nextSource(prev, newer)).toEqual(newer);
  });
});

describe("isSelfHit", () => {
  it("matches a bare linked target uuid", () => {
    expect(isSelfHit("a1", ["Actor.a1"])).toBe(true);
  });

  it("matches an unlinked synthetic target uuid by its actor-id suffix", () => {
    expect(isSelfHit("a1", ["Scene.s.Token.t.Actor.a1"])).toBe(true);
  });

  it("does not match a different actor", () => {
    expect(isSelfHit("a1", ["Actor.a2", "Scene.s.Token.t.Actor.a3"])).toBe(false);
  });

  it("is false with an empty attacker id", () => {
    expect(isSelfHit("", ["Actor.a1"])).toBe(false);
  });
});

describe("selectAttribution", () => {
  const src: Source = { ...evt };

  it("returns attacker + item when the dead actor is a target and within the window", () => {
    expect(selectAttribution(src, "Actor.boss", 20000, 45000)).toEqual({ attackerName: "Richard", itemName: "GUN" });
  });

  it("returns null when the dead actor was not a target", () => {
    expect(selectAttribution(src, "Actor.other", 20000, 45000)).toBeNull();
  });

  it("returns null when the source is older than the window", () => {
    expect(selectAttribution(src, "Actor.boss", 60000, 45000)).toBeNull();
  });

  it("attributes at exactly the window edge (now - timestamp == windowMs)", () => {
    // timestamp 1000, window 45000 -> edge at now = 46000
    expect(selectAttribution(src, "Actor.boss", 46000, 45000)).toEqual({
      attackerName: "Richard",
      itemName: "GUN"
    });
  });

  it("drops attribution one ms past the window", () => {
    expect(selectAttribution(src, "Actor.boss", 46001, 45000)).toBeNull();
  });

  it("returns null for a missing source", () => {
    expect(selectAttribution(null, "Actor.boss", 1000, 45000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/kill-source.test.ts`
Expected: FAIL ("Cannot find module '../src/logic/kill-source'").

- [ ] **Step 3: Write minimal implementation**

Create `src/logic/kill-source.ts`:

```ts
/**
 * @file Pure kill-attribution logic: a reducer that records the last real damage
 * source and a selector that decides whether it credits a given dead actor. All
 * matching is by actor UUID. No Foundry globals, no side effects.
 */

/** A single damage event distilled from a dnd5e damage chat card. */
export interface DamageEvent {
  /** Display name of the acting actor. */
  attackerName: string;
  /** The acting actor's id (link-mode agnostic; from the card speaker). */
  attackerActorId: string;
  /** Name of the weapon/spell/feature used, or `null` when unknown. */
  itemName: string | null;
  /** UUIDs of the actors the damage was rolled against. */
  targetUuids: string[];
  /** Capture time in epoch milliseconds. */
  timestamp: number;
}

/** The recorded last-damage source; identical in shape to a {@link DamageEvent}. */
export type Source = DamageEvent;

/** The resolved credit for a boss death. */
export interface Attribution {
  /** Display name of the killer. */
  attackerName: string;
  /** Weapon/spell/feature name, or `null`. */
  itemName: string | null;
}

/**
 * Fold a new damage event into the recorded source. Keeps the prior record for
 * events that cannot attribute: those with no target, or a self-hit (the attacker
 * is among its own targets).
 *
 * @param prev - The current recorded source, or `null`.
 * @param event - The incoming damage event.
 * @returns The event as the new source, or `prev` unchanged.
 */
export function nextSource(prev: Source | null, event: DamageEvent): Source | null {
  if (event.attackerName === "") return prev; // no usable killer name -> not attributable
  if (event.targetUuids.length === 0) return prev;
  if (isSelfHit(event.attackerActorId, event.targetUuids)) return prev;
  return { ...event };
}

/**
 * Whether the acting actor is among its own targets, matching by the actor-id
 * suffix of each target UUID. Works for both link modes: a linked target UUID is
 * `Actor.<id>` and an unlinked one is `Scene.x.Token.y.Actor.<id>`, and the card
 * speaker's `actor` is that same base id in both cases.
 *
 * @param attackerActorId - The acting actor's id.
 * @param targetUuids - The damage's target UUIDs.
 * @returns `true` when a target resolves to the attacker's actor id.
 */
export function isSelfHit(attackerActorId: string, targetUuids: string[]): boolean {
  if (attackerActorId === "") return false;
  const marker = "Actor.";
  return targetUuids.some((uuid) => {
    const at = uuid.lastIndexOf(marker);
    const targetActorId = at >= 0 ? uuid.slice(at + marker.length) : uuid;
    return targetActorId === attackerActorId;
  });
}

/**
 * Decide whether the recorded source credits a given dead actor.
 *
 * @param source - The recorded last-damage source, or `null`.
 * @param deadActorUuid - UUID of the actor that just died.
 * @param now - Current time in epoch milliseconds.
 * @param windowMs - How recent the source must be to attribute.
 * @returns The attribution, or `null` for the plain fallback message.
 */
export function selectAttribution(
  source: Source | null,
  deadActorUuid: string,
  now: number,
  windowMs: number
): Attribution | null {
  if (!source) return null;
  if (!source.targetUuids.includes(deadActorUuid)) return null;
  if (now - source.timestamp > windowMs) return null;
  return { attackerName: source.attackerName, itemName: source.itemName };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/kill-source.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/kill-source.ts test/kill-source.test.ts
git commit -m "feat: add pure kill-source reducer and attribution selector"
```

---

### Task 5: `kill-message.ts` - message selector (pure, TDD)

**Files:**
- Create: `src/logic/kill-message.ts`
- Test: `test/kill-message.test.ts`

**Interfaces:**
- Consumes: `Attribution` from `src/logic/kill-source.ts`.
- Produces: `interface KillMessage { key: string; data: Record<string, string> }`; `killMessageKey(bossName: string, attribution: Attribution | null): KillMessage`.

- [ ] **Step 1: Write the failing test**

Create `test/kill-message.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/kill-message.test.ts`
Expected: FAIL ("Cannot find module '../src/logic/kill-message'").

- [ ] **Step 3: Write minimal implementation**

Create `src/logic/kill-message.ts`:

```ts
/**
 * @file Pure selector mapping a boss death + optional attribution to an i18n key
 * and interpolation data. The adapter localizes. No Foundry globals.
 */

import type { Attribution } from "./kill-source";

/** An i18n key plus its interpolation data. */
export interface KillMessage {
  /** The localization key. */
  key: string;
  /** Interpolation values (`killer`, `boss`, `weapon`). */
  data: Record<string, string>;
}

/**
 * Choose the boss-death chat message for a given attribution.
 *
 * @param bossName - Display name of the boss that fell.
 * @param attribution - The resolved credit, or `null` for the plain fallback.
 * @returns The i18n key and interpolation data.
 */
export function killMessageKey(bossName: string, attribution: Attribution | null): KillMessage {
  if (!attribution) {
    return { key: "TACTICAL_INITIATIVE.Chat.BossDied", data: { boss: bossName } };
  }
  if (attribution.itemName === null) {
    return {
      key: "TACTICAL_INITIATIVE.Chat.BossKilledNoWeapon",
      data: { killer: attribution.attackerName, boss: bossName }
    };
  }
  return {
    key: "TACTICAL_INITIATIVE.Chat.BossKilled",
    data: { killer: attribution.attackerName, boss: bossName, weapon: attribution.itemName }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/kill-message.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/kill-message.ts test/kill-message.test.ts
git commit -m "feat: add pure killMessageKey selector"
```

---

### Task 6: `isExplicitlyTagged` (pure-testable adapter helper, TDD)

**Files:**
- Modify: `src/adapter/tags.ts`
- Test: `test/tags-explicit.test.ts`

**Interfaces:**
- Produces: `isExplicitlyTagged(actor: FoundryActor, tag: Tag): boolean` (reads the raw stored flag, bypassing `resolveTag` defaulting).

- [ ] **Step 1: Write the failing test**

Create `test/tags-explicit.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tags-explicit.test.ts`
Expected: FAIL ("isExplicitlyTagged is not a function" / import error).

- [ ] **Step 3: Write minimal implementation**

In `src/adapter/tags.ts`, add this export (keep the existing imports; `Tag` and `FLAGS`/`MODULE_ID` are already imported):

```ts
/**
 * Whether an actor carries an explicitly-stored tag equal to `tag`, ignoring the
 * type-based default. Used by F4 so only deliberately-tagged mobs auto-remove.
 *
 * @param actor - The actor to inspect.
 * @param tag - The tag to test for.
 * @returns `true` only when the stored tag flag equals `tag`.
 */
export function isExplicitlyTagged(actor: FoundryActor, tag: Tag): boolean {
  return actor.getFlag(MODULE_ID, FLAGS.TAG) === tag;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tags-explicit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapter/tags.ts test/tags-explicit.test.ts
git commit -m "feat: add isExplicitlyTagged for the F4 explicit-mob trigger"
```

---

### Task 7: Ambient types for the new adapter code

**Files:**
- Modify: `src/foundry-env.d.ts`

**Interfaces:**
- Produces: `FoundryActor.isToken/token/system/getActiveTokens`; `FoundryTokenDocument`; `FoundryChatMessage`; `fromUuidSync`; `game.actors.get` (already present), `game.combats.active`; `ChatMessage.create` whisper support.

- [ ] **Step 1: Extend the ambient declarations**

In `src/foundry-env.d.ts`, add these members to the `FoundryActor` interface:

```ts
  /** True when this is a synthetic actor backing an unlinked token. */
  readonly isToken?: boolean;
  /** For a token actor, its TokenDocument; otherwise null. */
  readonly token?: FoundryTokenDocument | null;
  /** dnd5e system data (subset): current hit points. */
  readonly system?: { attributes?: { hp?: { value?: number } } };
  /** Tokens for this actor on the active scene. Pass (false, true) for documents. */
  getActiveTokens(linked?: boolean, document?: boolean): FoundryTokenDocument[];
```

Add a new `FoundryTokenDocument` interface:

```ts
/** A core TokenDocument (subset used by F4). */
interface FoundryTokenDocument {
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly actorId: string | null;
  /** The scene this token belongs to. */
  readonly parent: { id: string } | null;
  /** This token's combatant in the active combat, if any. */
  readonly combatant: FoundryCombatant | null;
  update(data: object): Promise<FoundryTokenDocument>;
}
```

Add a `FoundryChatMessage` interface:

```ts
/** A ChatMessage document (subset used to capture dnd5e damage cards). */
interface FoundryChatMessage {
  readonly speaker?: { actor?: string; alias?: string };
  readonly flags?: {
    dnd5e?: {
      roll?: { type?: string };
      item?: { uuid?: string };
      // `uuid` in dnd5e 5.3; a later dnd5e renames the descriptor field to `actor`.
      targets?: { uuid?: string; actor?: string }[];
    };
  };
}
```

Extend `FoundryCombat` with the combatant-creation embedded method it already supports (used by the undo) - it is already declared via `createEmbeddedDocuments`; no change needed. Add `active` to the combats collection by extending the `FoundryGame.combats` type. Replace the `combats` line in `FoundryGame`:

```ts
  readonly combats: (FoundryCollection<FoundryCombat> & { active: FoundryCombat | null }) | null;
```

Extend `ChatMessageStatic` to accept a whisper array (already `create(data: object)`, so no change). Add the global `fromUuidSync` near the other ambient globals:

```ts
/** Foundry's synchronous UUID resolver (subset). */
declare function fromUuidSync(uuid: string): { name?: string } | null;
```

Add `game.actors.get` is already present via `FoundryCollection`. Add `game.user.id` for the GM whisper - `FoundryUser` already exposes `id`. No change.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/foundry-env.d.ts
git commit -m "chore: add ambient types for token/chat-card/uuid access"
```

---

### Task 8: `combat-events.ts` - the death/attribution watcher

**Files:**
- Create: `src/adapter/combat-events.ts`
- Modify: `src/adapter/hooks.ts` (export `isActiveGM` and `guard`)

**Interfaces:**
- Consumes: `hpTransition`, `crossedToZero`, `nextSource`, `selectAttribution`, `Source`, `killMessageKey`, `isExplicitlyTagged`, `readActorTag`, `getAnnounceBossDeath`, `getKillWindowMs`, `isActiveGM`, `guard`.
- Produces: `registerCombatEvents(): void`; `onActorDied(cb: (actor: FoundryActor) => void | Promise<void>): void`; `getLastDamageSource(): Source | null`.

- [ ] **Step 1: Export the two helpers from hooks.ts**

In `src/adapter/hooks.ts`, add `export` to the two existing functions:

```ts
export function isActiveGM(): boolean {
```
```ts
export function guard(label: string, body: () => Promise<void>): void {
```

- [ ] **Step 2: Write `combat-events.ts`**

Create `src/adapter/combat-events.ts`:

```ts
/**
 * @file GM-side combat-event watcher. Detects a creature reaching 0 HP exactly
 * once (via `dnd5e.damageActor`) and dispatches to F4 (mob remove+hide) and F5
 * (boss chat callout) subscribers. Captures the last damage source from dnd5e
 * chat cards (via `createChatMessage`, which broadcasts to the GM) for kill
 * attribution. Not unit-tested; covered by the README manual checklist. All
 * world mutation is elected-GM-only and every async body is guard-wrapped.
 */

import { MODULE_ID } from "../constants";
import { crossedToZero } from "../logic/death";
import { hpTransition, type HpChanges } from "../logic/hp";
import { killMessageKey } from "../logic/kill-message";
import { nextSource, selectAttribution, type Source } from "../logic/kill-source";
import { getAnnounceBossDeath, getKillWindowMs } from "../settings";
import { guard, isActiveGM } from "./hooks";
import { isExplicitlyTagged, readActorTag } from "./tags";

/** The last real damage source seen this session, GM-side. */
let lastDamageSource: Source | null = null;

/** Read the current recorded damage source (for later workstreams). */
export function getLastDamageSource(): Source | null {
  return lastDamageSource;
}

/** Subscribers notified when an actor crosses to 0 HP. */
type DiedCallback = (actor: FoundryActor) => void | Promise<void>;
const diedSubscribers: DiedCallback[] = [];

/**
 * Subscribe to the derived "actor died" event.
 *
 * @param cb - Called with the dead actor on the elected GM only.
 */
export function onActorDied(cb: DiedCallback): void {
  diedSubscribers.push(cb);
}

/**
 * Update the recorded damage source from a dnd5e damage chat card. Runs on the
 * GM because `createChatMessage` broadcasts. Best-effort: the exact flag paths
 * are verified by the manual checklist.
 *
 * @param message - The created chat message.
 */
function captureDamageSource(message: FoundryChatMessage): void {
  const dnd5e = message.flags?.dnd5e;
  if (!dnd5e || dnd5e.roll?.type !== "damage") return;
  // `uuid` in dnd5e 5.3; `actor` after a later descriptor rename. Read either.
  const targetUuids = (dnd5e.targets ?? [])
    .map((target) => target.uuid ?? target.actor)
    .filter((uuid): uuid is string => typeof uuid === "string");
  if (targetUuids.length === 0) return;
  const speaker = message.speaker ?? {};
  const attackerActorId = speaker.actor ?? "";
  const attackerName = speaker.alias ?? "";
  const itemUuid = dnd5e.item?.uuid;
  const itemName = itemUuid ? (fromUuidSync(itemUuid)?.name ?? null) : null;
  lastDamageSource = nextSource(lastDamageSource, {
    attackerName,
    attackerActorId,
    itemName,
    targetUuids,
    timestamp: Date.now()
  });
}

/**
 * Detect a death from a `dnd5e.damageActor` event and dispatch to subscribers.
 *
 * @param actor - The damaged actor (post-update).
 * @param changes - The signed-delta payload.
 */
async function detectDeath(actor: FoundryActor, changes: HpChanges): Promise<void> {
  const resultingHp = actor.system?.attributes?.hp?.value;
  if (typeof resultingHp !== "number") return;
  // dnd5e clamps hit points at 0, so a corpse-overkill reports changes.hp === 0 and
  // does not re-cross (verified against source; probe #1 confirms live). This early
  // return also skips the common alive case cheaply.
  if (resultingHp > 0) return;
  const { previousHp, newHp } = hpTransition(resultingHp, changes);
  if (!crossedToZero(previousHp, newHp)) return;
  for (const cb of diedSubscribers) {
    try {
      await cb(actor);
    } catch (error) {
      console.error(`${MODULE_ID} | onActorDied`, error);
    }
  }
}

/**
 * F4: remove an explicitly-tagged mob from combat and hide the token that died.
 *
 * @param actor - The dead actor.
 */
async function handleMobDeath(actor: FoundryActor): Promise<void> {
  if (!isExplicitlyTagged(actor, "mob")) return;
  // Unlinked mob: the hook's actor is the synthetic token actor, so this is the
  // exact token that died, scene-independently. Linked mob: all copies share one
  // HP pool, so every active token is genuinely dead.
  const tokens = actor.isToken && actor.token ? [actor.token] : actor.getActiveTokens(false, true);
  for (const token of tokens) {
    // Resolve across ALL combats: TokenDocument#combatant only sees the current
    // encounter, so a mob dying in a non-active combat would otherwise be skipped.
    const found = findCombatantForToken(token.id);
    if (!found) continue; // F4 is in-combat only; never orphan-hide with no undo path
    try {
      const name = token.name;
      await token.update({ hidden: true });
      await found.combatant.delete();
      await whisperRestoreLink(token, name, found.combat.id);
    } catch (error) {
      console.error(`${MODULE_ID} | handleMobDeath`, error);
    }
  }
}

/**
 * Find a token's combatant across every combat, not just the current encounter.
 *
 * @param tokenId - The token document id.
 * @returns The combatant and its combat, or `null` when the token is in no combat.
 */
function findCombatantForToken(
  tokenId: string
): { combatant: FoundryCombatant; combat: FoundryCombat } | null {
  for (const combat of game.combats?.contents ?? []) {
    const combatant = combat.combatants.find((c) => c.tokenId === tokenId);
    if (combatant) return { combatant, combat };
  }
  return null;
}

/**
 * Escape a string for safe inclusion in chat-message HTML.
 *
 * @param value - Untrusted text (e.g. a token name).
 * @returns The HTML-escaped text.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Whisper the GM a one-click link that restores a removed mob to its combat.
 *
 * @param token - The hidden token document.
 * @param name - The token's display name.
 * @param combatId - The id of the combat the mob was removed from.
 */
async function whisperRestoreLink(
  token: FoundryTokenDocument,
  name: string,
  combatId: string
): Promise<void> {
  const gmId = game.user?.id;
  if (!gmId) return;
  const label = escapeHtml(game.i18n.format("TACTICAL_INITIATIVE.Chat.RestoreMob", { name }));
  const content =
    `<button type="button" data-ti-token="${escapeHtml(token.uuid)}" ` +
    `data-ti-combat="${escapeHtml(combatId)}">${label}</button>`;
  await ChatMessage.create({ content, whisper: [gmId] });
}

/**
 * F5: post a public boss-death callout with best-effort kill attribution.
 *
 * @param actor - The dead actor.
 */
async function handleBossDeath(actor: FoundryActor): Promise<void> {
  if (readActorTag(actor) !== "boss") return;
  if (!getAnnounceBossDeath()) return;
  const attribution = selectAttribution(lastDamageSource, actor.uuid, Date.now(), getKillWindowMs());
  const { key, data } = killMessageKey(actor.name, attribution);
  await ChatMessage.create({ content: game.i18n.format(key, data) });
}

/**
 * Handle a click on a whispered "Restore to combat" button (GM only).
 *
 * @param tokenUuid - The token UUID from the button's data attribute.
 * @param combatId - The id of the combat to restore the mob into.
 */
async function restoreMob(tokenUuid: string, combatId: string): Promise<void> {
  if (!isActiveGM()) return;
  const token = fromUuidSync(tokenUuid) as unknown as FoundryTokenDocument | null;
  if (!token) return;
  await token.update({ hidden: false });
  const combat = game.combats?.get(combatId) ?? null;
  if (!combat) {
    ui.notifications?.warn(game.i18n.localize("TACTICAL_INITIATIVE.Chat.RestoreNoCombat"));
    return;
  }
  // Dedup against THIS combat's roster, not TokenDocument#combatant (which only
  // sees the current encounter and would let a re-click duplicate the combatant).
  const existing = combat.combatants.find((c) => c.tokenId === token.id);
  if (!existing) {
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: token.id, sceneId: token.parent?.id, actorId: token.actorId }
    ]);
  }
}

/**
 * Register the watcher and the delegated restore-button listener. Call once at init.
 */
export function registerCombatEvents(): void {
  Hooks.on("createChatMessage", (message: FoundryChatMessage): void => {
    if (!isActiveGM()) return;
    try {
      captureDamageSource(message);
    } catch (error) {
      console.error(`${MODULE_ID} | captureDamageSource`, error);
    }
  });

  Hooks.on("dnd5e.damageActor", (actor: FoundryActor, changes: HpChanges): void => {
    if (!isActiveGM()) return;
    guard("damageActor", () => detectDeath(actor, changes));
  });

  onActorDied(handleMobDeath);
  onActorDied(handleBossDeath);

  // Delegated, render-hook-independent click handler for the undo button.
  document.addEventListener("click", (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLElement>("[data-ti-token]");
    const tokenUuid = button?.dataset["tiToken"];
    const combatId = button?.dataset["tiCombat"];
    if (!button || !tokenUuid || !combatId) return;
    button.removeAttribute("data-ti-token"); // consume once: guard the double-click race
    guard("restoreMob", () => restoreMob(tokenUuid, combatId));
  });
}
```

- [ ] **Step 3: Typecheck and full check**

Run: `npx tsc --noEmit && npm run check`
Expected: PASS (typecheck clean, all existing + new unit tests green, build emits `scripts/main.js`).

- [ ] **Step 4: Commit**

```bash
git add src/adapter/combat-events.ts src/adapter/hooks.ts
git commit -m "feat: add combat-events watcher for mob removal and boss callouts"
```

---

### Task 9: Wire the watcher at init

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `registerCombatEvents` from `src/adapter/combat-events.ts`.

- [ ] **Step 1: Register at init**

In `src/main.ts`, add the import:

```ts
import { registerCombatEvents } from "./adapter/combat-events";
```

Add the call inside the `init` hook, after `registerHooks();`:

```ts
  registerCombatEvents();
```

- [ ] **Step 2: Build**

Run: `npm run check`
Expected: PASS (typecheck + tests + build).

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: register combat-events watcher at init"
```

---

### Task 10: Manifest floor + README manual checklist

**Files:**
- Modify: `module.json`
- Modify: `package.json`
- Modify: `README.md`
- Commit (built artifact): `scripts/main.js`, `scripts/main.js.map`

- [ ] **Step 1: Raise the compatibility floor**

In `module.json`, set `compatibility.minimum` to `"14"`:

```json
  "compatibility": {
    "minimum": "14",
    "verified": "14"
  },
```

Bump `module.json` `version` to `1.2.0`, and bump `package.json` `version` to `1.2.0` to keep the two manifests in step.

- [ ] **Step 2: Add the manual checklist to README**

In `README.md`, add a section documenting the probes and behavior checks from the spec's Testing section (checklist items 1-7): the two live probes first (`dnd5e.damageActor` delta + overkill-on-corpse; chat-card flag paths), then the five behavior checks (explicit-mob remove+hide + undo; boss attribution; plain fallback; no self-credit; toggle off + two-GM single-post).

- [ ] **Step 3: Verify build**

Run: `npm run check`
Expected: PASS. This re-emits `scripts/main.js` (+ `.map`), the git-tracked bundle Foundry actually loads.

- [ ] **Step 4: Commit (including the rebuilt bundle)**

```bash
git add module.json package.json README.md scripts/main.js scripts/main.js.map
git commit -m "chore: raise v14 floor to 1.2.0 and document automation checklist"
```

Staging `scripts/main.js`/`.map` is required: they are git-tracked and contain the F4/F5
code; a commit that ships 1.2.0 with a stale bundle would run none of this work.

---

## Live-world verification (after Task 10, before calling the feature done)

These cannot be covered by vitest (the adapter is untested by design). Run in a live
v14 + dnd5e 5.3 world:

1. **Probe - damageActor deltas:** log `changes` and `actor.system.attributes.hp.value`
   on a normal hit and on an overkill hit against a 0-HP actor; confirm `changes.hp` is
   clamped so `crossedToZero` does not re-fire. **If it is NOT clamped** (raw delta on a
   clamped value), delta arithmetic cannot recover the true previous HP: switch to tracking
   last-seen HP per actor uuid GM-side via a `preUpdateActor` hook and compare against it,
   instead of reconstructing `previousHp` from the delta.
2. **Probe - chat-card flags:** log `message.flags.dnd5e` and `message.speaker` on a
   player's attack and damage roll; confirm `item.uuid`, `targets[].uuid`, `roll.type`,
   and `speaker.alias` match the reads in `captureDamageSource`.
3. Tag an UNLINKED token `mob`, drop it to 0 while it is in combat -> only that token
   hides + leaves the tracker; sibling unlinked copies and an untagged NPC are untouched;
   the whispered "Restore" button re-adds it to the same combat. A `mob` dropped OUTSIDE
   combat is left alone (no orphan hide). Known limit: a LINKED mob only auto-removes when
   the active GM is viewing the combat's scene.
4. Non-active combat: with two combats present, kill a tagged `mob` in the combat that is
   NOT the active encounter -> it is still removed + hidden (confirms the across-combats
   combatant lookup, not `TokenDocument#combatant`).
5. Tag an UNLINKED token `boss`, have a player kill it with a targeted weapon -> public
   "X has killed BOSS with their WEAPON!".
6. A boss whose OWN attack was the last damage card before it dies is never credited for
   its own death (the `isSelfHit` filter; use an UNLINKED boss, the case the filter targets).
7. Kill a boss with an untargeted AoE or a manual HP edit -> public "BOSS has fallen!".
8. Toggle `announceBossDeath` off -> no boss message. With two GMs connected, a boss
   death posts exactly one message.
