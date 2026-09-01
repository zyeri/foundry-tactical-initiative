/**
 * @file The group control HUD: an ApplicationV2 pop-out listing a group's members
 * (name + HP) with four batch actions (select all, target all, apply
 * damage/healing, toggle a condition) driven by {@link GroupControlService} over
 * the real {@link FoundryGroupControlPort}. Foundry boundary: not unit-tested
 * (the service is). The ApplicationV2 render protocol and DialogV2 prompts are
 * the v14 assumptions documented in the README.
 */

import { MODULE_ID } from "../constants";
import { GroupControlService, type GroupMemberRef } from "../group-control-service";
import { FoundryGroupControlPort } from "./group-control";

/**
 * Open (render) the control HUD for a group in a combat.
 *
 * @param combat - The combat that owns the group.
 * @param groupId - The group id.
 */
export function openGroupHud(combat: FoundryCombat, groupId: string): void {
  void new GroupHud(combat, groupId).render(true);
}

/** The per-group control HUD window. */
class GroupHud extends foundry.applications.api.ApplicationV2 {
  private readonly service: GroupControlService;
  private readonly port: FoundryGroupControlPort;

  public static override DEFAULT_OPTIONS = {
    classes: [`${MODULE_ID}-group-hud`],
    window: { title: "TACTICAL_INITIATIVE.HUD.Title", resizable: true },
    position: { width: 320 }
  };

  /**
   * @param combat - The combat that owns the group.
   * @param groupId - The group id this HUD controls.
   */
  public constructor(combat: FoundryCombat, private readonly groupId: string) {
    super({ id: `${MODULE_ID}-group-hud-${groupId}` });
    this.port = new FoundryGroupControlPort(combat);
    this.service = new GroupControlService(this.port);
  }

  /** Build the panel content: a member list plus the action bar. */
  protected override async _renderHTML(_context: unknown, _options: unknown): Promise<HTMLElement> {
    const root = document.createElement("div");
    root.className = `${MODULE_ID}-group-hud-body`;
    const list = document.createElement("ul");
    list.className = `${MODULE_ID}-group-hud-members`;
    for (const member of this.port.members(this.groupId)) {
      list.appendChild(this.renderMember(member));
    }
    root.append(list, this.renderActions());
    return root;
  }

  /** Mount the built content and wire the action buttons. */
  protected override _replaceHTML(result: unknown, content: HTMLElement, _options: unknown): void {
    if (!(result instanceof HTMLElement)) return;
    content.replaceChildren(result);
    this.wireActions(content);
  }

  /** One member row: name + HP. */
  private renderMember(member: GroupMemberRef): HTMLElement {
    const li = document.createElement("li");
    li.className = `${MODULE_ID}-group-hud-member`;
    const hp = game.actors?.get(member.actorId)?.system?.attributes?.hp;
    const value = typeof hp?.value === "number" ? hp.value : null;
    const max = typeof hp?.max === "number" ? hp.max : null;
    const name = document.createElement("span");
    name.className = `${MODULE_ID}-group-hud-name`;
    name.textContent = member.name;
    const hpEl = document.createElement("span");
    hpEl.className = `${MODULE_ID}-group-hud-hp`;
    hpEl.textContent = value === null ? "" : max === null ? String(value) : `${value} / ${max}`;
    li.append(name, hpEl);
    return li;
  }

  /** The four action buttons. */
  private renderActions(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = `${MODULE_ID}-group-hud-actions`;
    const buttons: [string, string][] = [
      ["select", "TACTICAL_INITIATIVE.HUD.SelectAll"],
      ["target", "TACTICAL_INITIATIVE.HUD.TargetAll"],
      ["damage", "TACTICAL_INITIATIVE.HUD.ApplyDamage"],
      ["condition", "TACTICAL_INITIATIVE.HUD.Condition"]
    ];
    for (const [action, key] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset["tiAction"] = action;
      button.textContent = game.i18n.localize(key);
      bar.appendChild(button);
    }
    return bar;
  }

  /** Attach click handlers to the action buttons. */
  private wireActions(content: HTMLElement): void {
    const bind = (action: string, handler: () => void | Promise<void>): void => {
      const button = content.querySelector<HTMLButtonElement>(`button[data-ti-action='${action}']`);
      button?.addEventListener("click", () => void handler());
    };
    bind("select", () => this.service.selectAll(this.groupId));
    bind("target", () => this.service.targetAll(this.groupId));
    bind("damage", () => this.promptDamage());
    bind("condition", () => this.promptCondition());
  }

  /** Prompt for an amount + heal flag, then apply to every member. */
  private async promptDamage(): Promise<void> {
    const raw = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("TACTICAL_INITIATIVE.HUD.ApplyDamage") },
      modal: true,
      content:
        `<input type="number" name="value" value="0" min="0" style="width:100%" autofocus>` +
        `<label style="display:block;margin-top:0.3em">` +
        `<input type="checkbox" name="heal"> ${game.i18n.localize("TACTICAL_INITIATIVE.HUD.Heal")}</label>`,
      ok: {
        action: "ok",
        callback: (_event: Event, button: HTMLButtonElement): string => {
          const amount = button.form?.elements.namedItem("value");
          const heal = button.form?.elements.namedItem("heal");
          const value = amount instanceof HTMLInputElement ? amount.value : "0";
          const isHeal = heal instanceof HTMLInputElement && heal.checked;
          return `${isHeal ? "-" : ""}${value}`;
        }
      }
    });
    if (typeof raw !== "string") return;
    const amount = Math.abs(Number.parseInt(raw, 10));
    if (!Number.isFinite(amount) || amount <= 0) return;
    await this.service.applyToAll(this.groupId, { amount, isHealing: raw.startsWith("-") });
  }

  /** Prompt for a status id, then toggle it on every member. */
  private async promptCondition(): Promise<void> {
    const statusId = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("TACTICAL_INITIATIVE.HUD.Condition") },
      modal: true,
      content: `<input type="text" name="value" placeholder="prone" style="width:100%" autofocus>`,
      ok: {
        action: "ok",
        callback: (_event: Event, button: HTMLButtonElement): string => {
          const field = button.form?.elements.namedItem("value");
          return field instanceof HTMLInputElement ? field.value.trim() : "";
        }
      }
    });
    if (typeof statusId !== "string" || statusId.length === 0) return;
    await this.service.setConditionAll(this.groupId, statusId, true);
  }
}
