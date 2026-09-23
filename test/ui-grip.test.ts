// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { attachGrip, type GripOptions } from "../src/ui/grip";

let size: number;
let previews: number[];
let commits: number[];
let grip: HTMLElement;
let strip: HTMLElement;

function options(): GripOptions {
  return {
    read: () => size,
    preview: (px) => {
      size = px;
      previews.push(px);
    },
    commit: (px) => commits.push(px),
    clamp: (px) => Math.min(128, Math.max(32, Math.round(px))),
    min: 32,
    max: 128,
    defaultSize: 44,
    step: 4
  };
}

function pointer(type: string, clientY: number, pointerId: number = 1): void {
  grip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY, pointerId }));
}

beforeEach(() => {
  document.body.replaceChildren();
  const bar = document.createElement("div");
  strip = document.createElement("div");
  grip = document.createElement("div");
  bar.append(strip, grip);
  document.body.appendChild(bar);
  size = 44;
  previews = [];
  commits = [];
  attachGrip(grip, options());
});

describe("attachGrip", () => {
  it("dragging down grows the size live and commits once on release", () => {
    pointer("pointerdown", 100);
    pointer("pointermove", 110);
    pointer("pointermove", 120);
    pointer("pointerup", 120);
    expect(previews).toEqual([54, 64]);
    expect(commits).toEqual([64]);
  });

  it("clamps while dragging", () => {
    pointer("pointerdown", 100);
    pointer("pointermove", 400);
    pointer("pointerup", 400);
    expect(commits).toEqual([128]);
  });

  it("no commit when the size did not change", () => {
    pointer("pointerdown", 100);
    pointer("pointerup", 100);
    expect(commits).toEqual([]);
  });

  it("ignores moves when no drag is active", () => {
    pointer("pointermove", 150);
    expect(previews).toEqual([]);
  });

  it("lostpointercapture ends the drag and commits", () => {
    pointer("pointerdown", 100);
    pointer("pointermove", 90);
    grip.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1 }));
    pointer("pointermove", 50);
    expect(commits).toEqual([34]);
    expect(previews).toEqual([34]);
  });

  it("strip redraw mid-drag does not end the drag", () => {
    pointer("pointerdown", 100);
    strip.replaceChildren(document.createElement("span"));
    pointer("pointermove", 116);
    pointer("pointerup", 116);
    expect(commits).toEqual([60]);
  });

  it("pointerdown does not bubble to the bar", () => {
    let bubbled = false;
    grip.parentElement?.addEventListener("pointerdown", () => {
      bubbled = true;
    });
    pointer("pointerdown", 100);
    expect(bubbled).toBe(false);
  });

  it("double-click resets to the default and cancels an active drag", () => {
    size = 80;
    pointer("pointerdown", 100);
    grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    pointer("pointerup", 140);
    expect(commits).toEqual([44]);
    expect(size).toBe(44);
  });

  it("keyboard: ArrowDown grows, ArrowUp shrinks, Home resets", () => {
    const key = (k: string): void => {
      grip.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    };
    key("ArrowDown");
    key("ArrowUp");
    key("ArrowUp");
    key("Home");
    expect(commits).toEqual([48, 44, 40, 44]);
  });

  it("exposes slider semantics for assistive tech", () => {
    expect(grip.getAttribute("role")).toBe("separator");
    expect(grip.tabIndex).toBe(0);
    expect(grip.getAttribute("aria-valuemin")).toBe("32");
    expect(grip.getAttribute("aria-valuemax")).toBe("128");
    pointer("pointerdown", 100);
    pointer("pointermove", 120);
    expect(grip.getAttribute("aria-valuenow")).toBe("64");
  });

  it("a second pointer during a drag is ignored", () => {
    pointer("pointerdown", 100, 1);
    pointer("pointerdown", 300, 2);
    pointer("pointermove", 320, 2);
    pointer("pointermove", 110, 1);
    pointer("pointerup", 110, 1);
    expect(previews).toEqual([54]);
    expect(commits).toEqual([54]);
  });

  it("pointerup from another pointer does not end the drag", () => {
    pointer("pointerdown", 100, 1);
    pointer("pointerup", 100, 2);
    pointer("pointermove", 120, 1);
    pointer("pointerup", 120, 1);
    expect(commits).toEqual([64]);
  });
});
