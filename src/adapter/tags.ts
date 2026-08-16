/**
 * @file Adapter helpers for reading and writing an actor's tactical tag against
 * live Foundry documents.
 */

import { FLAGS, MODULE_ID, type Tag } from "../constants";
import { resolveTag } from "../logic/tag";

/**
 * Read an actor's effective tactical tag, applying the type-based default when
 * the flag is unset or invalid.
 *
 * @param actor - The actor, or `null`.
 * @returns The resolved {@link Tag}; defaults to `"mob"` for a missing actor.
 */
export function readActorTag(actor: FoundryActor | null): Tag {
  if (!actor) return "mob";
  const stored = actor.getFlag(MODULE_ID, FLAGS.TAG);
  return resolveTag(actor.type, typeof stored === "string" ? stored : null);
}

/**
 * The effective tag of a combatant's actor.
 *
 * @param combatant - The combatant.
 * @returns The resolved {@link Tag}.
 */
export function readCombatantTag(combatant: FoundryCombatant): Tag {
  return readActorTag(combatant.actor);
}

/**
 * Persist a tactical tag on an actor.
 *
 * @param actor - The actor to tag.
 * @param tag - The new tag.
 */
export async function writeActorTag(actor: FoundryActor, tag: Tag): Promise<void> {
  await actor.setFlag(MODULE_ID, FLAGS.TAG, tag);
}
