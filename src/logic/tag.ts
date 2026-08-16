/**
 * @file Pure tag-resolution logic. No Foundry globals, no side effects.
 */

import { TAGS, type Tag } from "../constants";

/**
 * Type guard: is a value one of the three valid {@link Tag} strings?
 *
 * @param value - Any value, typically a stored actor flag.
 * @returns `true` when `value` is `"player"`, `"boss"`, or `"mob"`.
 */
function isTag(value: unknown): value is Tag {
  return typeof value === "string" && (TAGS as readonly string[]).includes(value);
}

/**
 * Resolve the effective tactical tag for an actor.
 *
 * A stored tag wins when it is valid. Otherwise the tag defaults by actor type:
 * `"character"` actors default to {@link Tag} `"player"`; every other type
 * (npc, vehicle, group, ...) defaults to `"mob"`.
 *
 * @param actorType - The actor's `type` (e.g. `"character"`, `"npc"`).
 * @param storedTag - The value of the module tag flag, or `null`/`undefined` when unset.
 * @returns The tag to use for initiative behavior.
 */
export function resolveTag(actorType: string, storedTag: string | null | undefined): Tag {
  if (isTag(storedTag)) return storedTag;
  return actorType === "character" ? "player" : "mob";
}
