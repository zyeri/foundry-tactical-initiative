// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { closeMenu, openMenu } from "../src/ui/menu";

const ID = "ti-menu";

afterEach(() => {
  closeMenu(document, ID);
});

function pointer(type: string, target: EventTarget): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true }));
}

describe("openMenu", () => {
  it("pointerdown then click on an item runs it", async () => {
    let ran = 0;
    const menu = openMenu(document, ID, "m", [{ label: "Tag", run: () => { ran += 1; } }], 10, 20);
    const item = menu?.querySelector("button");
    expect(item).toBeTruthy();
    pointer("pointerdown", item as HTMLElement);
    (item as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ran).toBe(1);
    expect(document.getElementById(ID)).toBeNull();
  });

  it("pointerdown outside closes the menu", () => {
    openMenu(document, ID, "m", [{ label: "Tag", run: () => undefined }], 0, 0);
    pointer("pointerdown", document.body);
    expect(document.getElementById(ID)).toBeNull();
  });

  it("returns null and shows nothing for an empty item list", () => {
    expect(openMenu(document, ID, "m", [], 0, 0)).toBeNull();
    expect(document.getElementById(ID)).toBeNull();
  });

  it("reopening replaces the previous menu and its outside listener", () => {
    openMenu(document, ID, "m", [{ label: "A", run: () => undefined }], 0, 0);
    const second = openMenu(document, ID, "m", [{ label: "B", run: () => undefined }], 0, 0);
    expect(document.querySelectorAll(`#${ID}`)).toHaveLength(1);
    pointer("pointerdown", second as HTMLElement);
    expect(document.getElementById(ID)).toBe(second);
  });

  it("reports a failing item through the reporter", async () => {
    const seen: string[] = [];
    const menu = openMenu(
      document,
      ID,
      "m",
      [{ label: "Bad", run: () => { throw new Error("no"); } }],
      0,
      0,
      (label) => seen.push(label)
    );
    (menu?.querySelector("button") as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["menu:Bad"]);
  });
});
