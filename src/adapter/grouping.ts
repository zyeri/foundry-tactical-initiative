/**
 * @file The real {@link GroupingPort}: binds the battlemap Group Selected action
 * to Foundry combats, combatants, CombatantGroups, and a DialogV2 prompt. Foundry
 * boundary: not unit-tested (GroupingService is); README checklist covers it.
 */

import { FLAGS, MODULE_ID } from "../constants";
import type {
  GroupingCombatantRef,
  GroupingPort,
  GroupPromptRequest,
  GroupPromptResult
} from "../grouping-service";
import { groupIdOf, type GroupRef } from "../logic/group";
import { getPlayerTimeoutMs } from "../settings";
import { reconcileBossOnRetag, tearDownBossSlots } from "./boss-slots";
import { FoundryAdapter } from "./foundry-adapter";
import { DEFAULT_GROUP_COLOR, groupColor } from "./groups";

/** The Combat document class (subset) from CONFIG. */
function combatClass(): { create(data: object): Promise<FoundryCombat> } {
  return (CONFIG as unknown as { Combat: { documentClass: { create(data: object): Promise<FoundryCombat> } } })
    .Combat.documentClass;
}

/** Escape text for HTML content and attribute values. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Read the dialog's name input from a clicked button's form. */
function readName(button: HTMLButtonElement): string {
  const field = button.form?.elements.namedItem("name");
  return field instanceof HTMLInputElement ? field.value : "";
}

/** A {@link GroupingPort} bound to the viewed scene. */
export class FoundryGroupingPort implements GroupingPort {
  /** Resolve a combat by id or throw (ids come from resolveCombat). */
  private combat(combatId: string): FoundryCombat {
    const combat = game.combats?.get(combatId);
    if (!combat) throw new Error(`combat ${combatId} not found`);
    return combat;
  }

  public async resolveCombat(): Promise<string | null> {
    const sceneId = canvas.scene?.id ?? null;
    if (sceneId === null) return null;
    const viewed = game.combat ?? null;
    let combat: FoundryCombat | null =
      viewed && (viewed.scene === null || viewed.scene.id === sceneId) ? viewed : null;
    combat ??= game.combats?.find((c) => c.scene?.id === sceneId) ?? null;
    combat ??= await combatClass().create({ scene: sceneId, active: true });
    if (!combat.active) await combat.activate();
    return combat.id;
  }

  public listCombatants(combatId: string): GroupingCombatantRef[] {
    return this.combat(combatId).combatants.contents.map((c) => ({
      id: c.id,
      tokenId: c.tokenId,
      groupId: groupIdOf(c),
      initiative: c.initiative,
      bossEndSlot: c.getFlag(MODULE_ID, FLAGS.BOSS_SLOT) === "end"
    }));
  }

  public listGroups(combatId: string): GroupRef[] {
    return this.combat(combatId).groups.contents.map((g) => ({ id: g.id, name: g.name, color: groupColor(g) }));
  }

  public isStarted(combatId: string): boolean {
    return this.combat(combatId).started;
  }

  public tokenActorNames(tokenIds: readonly string[]): string[] {
    return tokenIds.map((id) => {
      const doc = canvas.tokens?.get(id)?.document;
      return doc?.actor?.name ?? doc?.name ?? "";
    });
  }

  public fallbackGroupName(): string {
    return game.i18n.localize("TACTICAL_INITIATIVE.Group.FallbackName");
  }

  public async createGroup(combatId: string, name: string): Promise<string> {
    const created = (await this.combat(combatId).createEmbeddedDocuments("CombatantGroup", [
      { name, flags: { [MODULE_ID]: { [FLAGS.GROUP_COLOR]: DEFAULT_GROUP_COLOR } } }
    ])) as unknown as FoundryCombatantGroup[];
    const group = created[0];
    if (!group) throw new Error("CombatantGroup was not created");
    return group.id;
  }

  public async createCombatants(
    combatId: string,
    tokenIds: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<string[]> {
    const sceneId = canvas.scene?.id ?? null;
    const data = tokenIds.flatMap((tokenId) => {
      const doc = canvas.tokens?.get(tokenId)?.document;
      if (!doc) return [];
      return [
        {
          tokenId,
          sceneId,
          actorId: doc.actorId,
          hidden: doc.hidden === true,
          group: groupId,
          ...(initiative !== null ? { initiative } : {})
        }
      ];
    });
    if (data.length === 0) return [];
    const created = await this.combat(combatId).createEmbeddedDocuments("Combatant", data);
    return created.map((c) => c.id);
  }

  public async assign(
    combatId: string,
    ids: readonly string[],
    groupId: string,
    initiative: number | null
  ): Promise<void> {
    await this.combat(combatId).updateEmbeddedDocuments(
      "Combatant",
      ids.map((id) => ({ _id: id, group: groupId, ...(initiative !== null ? { initiative } : {}) }))
    );
  }

  public async unassign(combatId: string, ids: readonly string[]): Promise<void> {
    await this.combat(combatId).updateEmbeddedDocuments(
      "Combatant",
      ids.map((id) => ({ _id: id, group: null }))
    );
  }

  public async deleteGroup(combatId: string, groupId: string): Promise<void> {
    const combat = this.combat(combatId);
    if (combat.groups.get(groupId)) await combat.deleteEmbeddedDocuments("CombatantGroup", [groupId]);
  }

  public async rollGroupInitiative(combatId: string, groupId: string): Promise<number | null> {
    const combat = this.combat(combatId);
    const hasMember = combat.combatants.contents.some((c) => groupIdOf(c) === groupId);
    if (!hasMember) return null;
    return new FoundryAdapter(combat, getPlayerTimeoutMs()).rollGroupInitiative(groupId);
  }

  public async setInitiative(combatId: string, ids: readonly string[], value: number): Promise<void> {
    await this.combat(combatId).updateEmbeddedDocuments(
      "Combatant",
      ids.map((id) => ({ _id: id, initiative: value }))
    );
  }

  public async tearDownBoss(combatId: string, ids: readonly string[]): Promise<void> {
    const combat = this.combat(combatId);
    for (const id of ids) {
      const combatant = combat.combatants.get(id);
      if (combatant) await tearDownBossSlots(combatant, combat);
    }
  }

  public async reconcileBoss(combatId: string, ids: readonly string[]): Promise<void> {
    const combat = this.combat(combatId);
    for (const id of ids) {
      const combatant = combat.combatants.get(id);
      if (combatant) await reconcileBossOnRetag(combatant, combat);
    }
  }

  public async prompt(request: GroupPromptRequest): Promise<GroupPromptResult> {
    const legend = request.options
      .map(
        (g) =>
          `<li><span style="display:inline-block;width:0.8em;height:0.8em;border-radius:50%;background:${escapeHtml(
            g.color ?? DEFAULT_GROUP_COLOR
          )}"></span> ${escapeHtml(g.name)}</li>`
      )
      .join("");
    const content =
      `<label>${escapeHtml(game.i18n.localize("TACTICAL_INITIATIVE.Grouping.NameLabel"))}` +
      ` <input type="text" name="name" value="${escapeHtml(request.defaultName)}" autofocus></label>` +
      `<p>${escapeHtml(game.i18n.localize("TACTICAL_INITIATIVE.Grouping.Existing"))}</p><ul>${legend}</ul>`;
    const buttons: DialogV2Button[] = [
      {
        action: "new",
        label: game.i18n.localize("TACTICAL_INITIATIVE.Grouping.NewGroup"),
        default: true,
        callback: (_event, button) => ({ action: "new", name: readName(button) })
      },
      ...request.options.map(
        (g): DialogV2Button => ({
          action: `join-${g.id}`,
          label: game.i18n.format("TACTICAL_INITIATIVE.Grouping.Join", { name: escapeHtml(g.name) }),
          callback: () => ({ action: "join", groupId: g.id })
        })
      )
    ];
    if (request.offerRemove) {
      buttons.push({
        action: "remove",
        label: game.i18n.localize("TACTICAL_INITIATIVE.Grouping.RemoveFromGroup"),
        callback: () => ({ action: "remove" })
      });
    }
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("TACTICAL_INITIATIVE.Grouping.DialogTitle") },
      content,
      buttons,
      rejectClose: false,
      modal: true
    });
    return result && typeof result === "object" && "action" in result ? (result as GroupPromptResult) : null;
  }

  public warn(key: "NothingSelected" | "NoScene"): void {
    ui.notifications?.warn(game.i18n.localize(`TACTICAL_INITIATIVE.Grouping.${key}`));
  }
}
