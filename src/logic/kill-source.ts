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

/** The subset of a dnd5e chat message this module reads to attribute a kill. */
export interface DamageCardLike {
  /** Message flags carrying the dnd5e roll metadata. */
  flags?: {
    dnd5e?: {
      roll?: { type?: string };
      item?: { uuid?: string };
      // `uuid` in dnd5e 5.3; a later dnd5e renames the descriptor field to `actor`.
      targets?: { uuid?: string; actor?: string }[];
    };
  };
  /** The message speaker: the acting actor's id and display alias. */
  speaker?: { actor?: string; alias?: string };
}

/**
 * Distill a dnd5e damage chat card into a {@link DamageEvent}. Returns `null` when
 * the card is not a damage roll or has no targets - the two cases that cannot
 * attribute a kill. The item name is resolved through an injected function so this
 * stays free of Foundry globals.
 *
 * @param card - The chat message (only the read fields matter).
 * @param now - Capture time in epoch milliseconds.
 * @param resolveItemName - Maps an item UUID to a display name, or `null`.
 * @returns The distilled event, or `null` when the card cannot attribute.
 */
export function parseDamageCard(
  card: DamageCardLike,
  now: number,
  resolveItemName: (itemUuid: string) => string | null
): DamageEvent | null {
  const dnd5e = card.flags?.dnd5e;
  if (!dnd5e || dnd5e.roll?.type !== "damage") return null;
  const targetUuids = (dnd5e.targets ?? [])
    .map((target) => target.uuid ?? target.actor)
    .filter((uuid): uuid is string => typeof uuid === "string");
  if (targetUuids.length === 0) return null;
  const speaker = card.speaker ?? {};
  const itemUuid = dnd5e.item?.uuid;
  return {
    attackerName: speaker.alias ?? "",
    attackerActorId: speaker.actor ?? "",
    itemName: itemUuid ? resolveItemName(itemUuid) : null,
    targetUuids,
    timestamp: now
  };
}

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
