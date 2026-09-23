/**
 * @file A tiny fixed-position context menu with no Foundry dependencies, so its
 * event handling is tested under happy-dom. Closes on a pointerdown OUTSIDE the
 * menu only; a pointerdown on an item must not remove the item before its click
 * fires (the v1.5.0 dead-menu bug).
 */

import { runSafe, type ErrorReporter } from "./run-safe";

/** One menu entry. */
export interface MenuItem {
  label: string;
  run: () => unknown;
}

/** Outside-click listeners per menu id, so close() can detach them. */
const outsideListeners = new Map<string, (event: Event) => void>();

/**
 * Remove the menu with `id` and its outside-click listener.
 *
 * @param doc - The document hosting the menu.
 * @param id - The menu element id.
 */
export function closeMenu(doc: Document, id: string): void {
  const listener = outsideListeners.get(id);
  if (listener) {
    doc.removeEventListener("pointerdown", listener, true);
    outsideListeners.delete(id);
  }
  doc.getElementById(id)?.remove();
}

/**
 * Open a menu at viewport (x, y), replacing any open menu with the same id.
 *
 * @param doc - The document to render into.
 * @param id - Element id (one menu per id).
 * @param className - CSS class; items get `${className}-item`.
 * @param items - Entries; none means no menu.
 * @param x - Left, px.
 * @param y - Top, px.
 * @param report - Failure sink passed to {@link runSafe}.
 * @returns The menu element, or `null` when `items` is empty.
 */
export function openMenu(
  doc: Document,
  id: string,
  className: string,
  items: readonly MenuItem[],
  x: number,
  y: number,
  report?: ErrorReporter
): HTMLElement | null {
  closeMenu(doc, id);
  if (items.length === 0) return null;
  const menu = doc.createElement("nav");
  menu.id = id;
  menu.className = className;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const entry of items) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `${className}-item`;
    button.textContent = entry.label;
    button.addEventListener("click", () => {
      closeMenu(doc, id);
      void runSafe(`menu:${entry.label}`, entry.run, report);
    });
    menu.appendChild(button);
  }
  const outside = (event: Event): void => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    closeMenu(doc, id);
  };
  outsideListeners.set(id, outside);
  doc.addEventListener("pointerdown", outside, true);
  doc.body.appendChild(menu);
  return menu;
}
