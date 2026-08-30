/**
 * @file Pure kill-attribution logic: a reducer that records the last real damage
 * source and a selector that decides whether it credits a given dead actor. All
 * matching is by actor UUID / id. No Foundry globals, no side effects.
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
 * Fold a new damage event into the recorded source. Keeps the prior record for
 * events that cannot attribute: those with no usable killer name, no target, or a
 * self-hit (the attacker is among its own targets).
 *
 * @param prev - The current recorded source, or `null`.
 * @param event - The incoming damage event.
 * @returns The event as the new source, or `prev` unchanged.
 */
export function nextSource(prev: Source | null, event: DamageEvent): Source | null {
  if (event.attackerName === "") return prev;
  if (event.targetUuids.length === 0) return prev;
  if (isSelfHit(event.attackerActorId, event.targetUuids)) return prev;
  return { ...event };
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
