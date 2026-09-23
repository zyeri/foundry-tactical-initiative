/**
 * @file Pure detection of combatants left behind after their token was deleted
 * (core Foundry normally removes them; this finds what it missed). No Foundry
 * globals; the adapter supplies candidates and a token-existence check.
 */

/** A combatant that might have lost its token. */
export interface LeftoverCandidate {
  combatId: string;
  combatantId: string;
  name: string;
  sceneId: string | null;
  tokenId: string | null;
}

/** A deleted token, as reported by the deleteToken hook. */
export interface DeletedTokenRef {
  sceneId: string;
  tokenId: string;
}

/** A combatant to offer for removal. */
export interface Leftover {
  combatId: string;
  combatantId: string;
  name: string;
}

/**
 * Candidates whose (scene, token) was deleted and whose token no longer exists,
 * in input order, one entry per combatant.
 *
 * @param candidates - Combatants of every combat, in combat then turn order.
 * @param deleted - Deleted tokens collected since the last flush.
 * @param tokenExists - Whether a token still exists on its scene.
 * @returns The leftovers to offer for removal.
 */
export function findLeftovers(
  candidates: readonly LeftoverCandidate[],
  deleted: readonly DeletedTokenRef[],
  tokenExists: (sceneId: string, tokenId: string) => boolean
): Leftover[] {
  const keys = new Set(deleted.map((ref) => `${ref.sceneId}.${ref.tokenId}`));
  const seen = new Set<string>();
  const result: Leftover[] = [];
  for (const candidate of candidates) {
    const { sceneId, tokenId } = candidate;
    if (sceneId === null || tokenId === null) continue;
    if (!keys.has(`${sceneId}.${tokenId}`)) continue;
    if (tokenExists(sceneId, tokenId)) continue;
    const id = `${candidate.combatId}.${candidate.combatantId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({ combatId: candidate.combatId, combatantId: candidate.combatantId, name: candidate.name });
  }
  return result;
}
