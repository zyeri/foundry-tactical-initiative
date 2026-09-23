/**
 * @file A vertical resize grip with no Foundry dependencies, tested under
 * happy-dom. Dragging down grows the size, up shrinks it; the size is applied
 * live via `preview` and persisted once via `commit` when the drag ends (only
 * if it changed). Double-click resets; ArrowDown/ArrowUp/Home work when focused.
 * The grip must live outside any element that is rebuilt on redraw.
 */

/** Callbacks and bounds for {@link attachGrip}. */
export interface GripOptions {
  /** Current applied size, px. */
  read(): number;
  /** Apply a size live (no persistence). */
  preview(px: number): void;
  /** Persist a final size. */
  commit(px: number): void;
  /** Round and clamp a requested size. */
  clamp(px: number): number;
  /** Smallest size, px (for aria). */
  min: number;
  /** Largest size, px (for aria). */
  max: number;
  /** Size restored by double-click and Home. */
  defaultSize: number;
  /** Keyboard step, px. */
  step: number;
}

/**
 * Wire a resize grip element.
 *
 * @param grip - The grip element (persistent across redraws).
 * @param options - Size callbacks and bounds.
 * @returns A function that removes every listener.
 */
export function attachGrip(grip: HTMLElement, options: GripOptions): () => void {
  let dragging = false;
  let startY = 0;
  let startSize = 0;
  let current = 0;

  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-orientation", "horizontal");
  grip.setAttribute("aria-valuemin", String(options.min));
  grip.setAttribute("aria-valuemax", String(options.max));
  grip.setAttribute("aria-valuenow", String(options.read()));
  grip.tabIndex = 0;

  const apply = (px: number): void => {
    options.preview(px);
    grip.setAttribute("aria-valuenow", String(px));
  };

  const set = (px: number): void => {
    const next = options.clamp(px);
    const before = options.read();
    apply(next);
    if (next !== before) options.commit(next);
  };

  const onDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    startY = event.clientY;
    startSize = options.read();
    current = startSize;
    if (typeof grip.setPointerCapture === "function") {
      try {
        grip.setPointerCapture(event.pointerId);
      } catch {
        // Capture is best-effort; moves still arrive while the pointer is over the grip.
      }
    }
  };

  const onMove = (event: PointerEvent): void => {
    if (!dragging) return;
    current = options.clamp(startSize + (event.clientY - startY));
    apply(current);
  };

  const onEnd = (): void => {
    if (!dragging) return;
    dragging = false;
    if (current !== startSize) options.commit(current);
  };

  const onDblClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    dragging = false;
    set(options.defaultSize);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown") set(options.read() + options.step);
    else if (event.key === "ArrowUp") set(options.read() - options.step);
    else if (event.key === "Home") set(options.defaultSize);
    else return;
    event.preventDefault();
  };

  grip.addEventListener("pointerdown", onDown);
  grip.addEventListener("pointermove", onMove);
  grip.addEventListener("pointerup", onEnd);
  grip.addEventListener("pointercancel", onEnd);
  grip.addEventListener("lostpointercapture", onEnd);
  grip.addEventListener("dblclick", onDblClick);
  grip.addEventListener("keydown", onKey);

  return () => {
    grip.removeEventListener("pointerdown", onDown);
    grip.removeEventListener("pointermove", onMove);
    grip.removeEventListener("pointerup", onEnd);
    grip.removeEventListener("pointercancel", onEnd);
    grip.removeEventListener("lostpointercapture", onEnd);
    grip.removeEventListener("dblclick", onDblClick);
    grip.removeEventListener("keydown", onKey);
  };
}
