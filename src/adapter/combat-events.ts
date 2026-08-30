/**
 * @file The real {@link DeathPort} binding plus hook wiring for the F4/F5
 * automations. This is the thin Foundry boundary: it translates the service's
 * intent into live document calls and routes the `dnd5e.damageActor`,
 * `createChatMessage`, and restore-button events to the {@link DeathService}. It
 * is NOT unit-tested (all decisions live in the tested service); it is covered by
 * the README manual checklist. All world mutation is elected-GM-only and every
 * async hook body is guard-wrapped.
 */

import { MODULE_ID } from "../constants";
import {
  DeathService,
  type CombatantLocation,
  type DeathPort,
  type TokenRef
} from "../death-service";
import { parseDamageCard } from "../logic/kill-source";
import { getAnnounceBossDeath, getKillWindowMs } from "../settings";
import { guard, isActiveGM } from "./hooks";
import { isExplicitlyTagged, readActorTag } from "./tags";

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

/** Resolve a token UUID to its live document, or `null`. */
function tokenDoc(uuid: string): FoundryTokenDocument | null {
  return fromUuidSync(uuid) as unknown as FoundryTokenDocument | null;
}

/** The live-Foundry implementation of the death/attribution seam. */
class FoundryDeathPort implements DeathPort {
  public now(): number {
    return Date.now();
  }

  public actorHp(actor: unknown): number | null {
    const hp = (actor as FoundryActor).system?.attributes?.hp?.value;
    return typeof hp === "number" ? hp : null;
  }

  public actorUuid(actor: unknown): string {
    return (actor as FoundryActor).uuid;
  }

  public actorName(actor: unknown): string {
    return (actor as FoundryActor).name;
  }

  public isExplicitMob(actor: unknown): boolean {
    return isExplicitlyTagged(actor as FoundryActor, "mob");
  }

  public isBoss(actor: unknown): boolean {
    return readActorTag(actor as FoundryActor) === "boss";
  }

  public tokensForActor(actor: unknown): TokenRef[] {
    const a = actor as FoundryActor;
    // Unlinked actor: the hook's actor IS the synthetic token actor, so this is
    // the exact token that died (scene-independent). Linked: all copies are dead.
    const tokens = a.isToken && a.token ? [a.token] : a.getActiveTokens(false, true);
    return tokens.map((token) => ({ id: token.id, uuid: token.uuid, name: token.name }));
  }

  public findCombatantForToken(tokenId: string): CombatantLocation | null {
    // Scan ALL combats: TokenDocument#combatant only sees the current encounter.
    for (const combat of game.combats?.contents ?? []) {
      const combatant = combat.combatants.find((entry) => entry.tokenId === tokenId);
      if (combatant) return { combatId: combat.id, combatantId: combatant.id };
    }
    return null;
  }

  public async hideToken(token: TokenRef): Promise<void> {
    await tokenDoc(token.uuid)?.update({ hidden: true });
  }

  public async removeCombatant(location: CombatantLocation): Promise<void> {
    const combatant = game.combats?.get(location.combatId)?.combatants.get(location.combatantId);
    if (combatant) await combatant.delete();
  }

  public async whisperRestore(token: TokenRef, combatId: string): Promise<void> {
    const gmId = game.user?.id;
    if (!gmId) return;
    const label = escapeHtml(
      game.i18n.format("TACTICAL_INITIATIVE.Chat.RestoreMob", { name: token.name })
    );
    const content =
      `<button type="button" data-ti-token="${escapeHtml(token.uuid)}" ` +
      `data-ti-combat="${escapeHtml(combatId)}">${label}</button>`;
    await ChatMessage.create({ content, whisper: [gmId] });
  }

  public announceBossDeath(): boolean {
    return getAnnounceBossDeath();
  }

  public killWindowMs(): number {
    return getKillWindowMs();
  }

  public async postPublic(content: string): Promise<void> {
    await ChatMessage.create({ content });
  }

  public localize(key: string, data: Record<string, string>): string {
    return game.i18n.format(key, data);
  }

  public resolveToken(tokenUuid: string): TokenRef | null {
    const token = tokenDoc(tokenUuid);
    return token ? { id: token.id, uuid: token.uuid, name: token.name } : null;
  }

  public async unhideToken(token: TokenRef): Promise<void> {
    await tokenDoc(token.uuid)?.update({ hidden: false });
  }

  public combatExists(combatId: string): boolean {
    return game.combats?.get(combatId) != null;
  }

  public combatHasToken(combatId: string, token: TokenRef): boolean {
    const combat = game.combats?.get(combatId);
    return combat?.combatants.find((entry) => entry.tokenId === token.id) != null;
  }

  public async addTokenToCombat(combatId: string, token: TokenRef): Promise<void> {
    const combat = game.combats?.get(combatId);
    const doc = tokenDoc(token.uuid);
    if (!combat || !doc) return;
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: doc.id, sceneId: doc.parent?.id, actorId: doc.actorId }
    ]);
  }

  public warnRestoreNoCombat(): void {
    ui.notifications?.warn(game.i18n.localize("TACTICAL_INITIATIVE.Chat.RestoreNoCombat"));
  }
}

/** The resolver that turns an item UUID into a display name. */
function resolveItemName(itemUuid: string): string | null {
  return fromUuidSync(itemUuid)?.name ?? null;
}

/**
 * Register the F4/F5 watcher and the restore-button listener. Call once at init.
 */
export function registerCombatEvents(): void {
  const service = new DeathService(new FoundryDeathPort());

  Hooks.on("createChatMessage", (message: FoundryChatMessage): void => {
    if (!isActiveGM()) return;
    try {
      service.recordDamage(parseDamageCard(message, Date.now(), resolveItemName));
    } catch (error) {
      console.error(`${MODULE_ID} | recordDamage`, error);
    }
  });

  Hooks.on("dnd5e.damageActor", (actor: FoundryActor, changes: unknown): void => {
    if (!isActiveGM()) return;
    guard("damageActor", () =>
      service.handleDamage(actor, changes as { hp: number; temp: number; total: number })
    );
  });

  // Delegated, render-hook-independent click handler for the undo button.
  document.addEventListener("click", (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLElement>("[data-ti-token]");
    const tokenUuid = button?.dataset["tiToken"];
    const combatId = button?.dataset["tiCombat"];
    if (!button || !tokenUuid || !combatId) return;
    button.removeAttribute("data-ti-token"); // consume once: guard the double-click race
    guard("restoreMob", () => service.restoreMob(tokenUuid, combatId));
  });
}
