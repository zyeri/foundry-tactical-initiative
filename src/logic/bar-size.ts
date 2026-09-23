/**
 * @file Pure top-bar size rules: bounds, default, and clamping for the
 * user-resizable portrait size. No Foundry globals.
 */

/** Smallest portrait size, px. */
export const BAR_MIN = 32;
/** Largest portrait size, px. */
export const BAR_MAX = 128;
/** Default portrait size, px (the v1.5.0 fixed size). */
export const BAR_DEFAULT = 44;

/**
 * Round and clamp a requested portrait size. `NaN` falls back to the default;
 * infinities clamp to the nearest bound.
 *
 * @param px - Requested size in pixels.
 * @returns A whole-pixel size within {@link BAR_MIN}..{@link BAR_MAX}.
 */
export function clampBarSize(px: number): number {
  if (Number.isNaN(px)) return BAR_DEFAULT;
  return Math.min(BAR_MAX, Math.max(BAR_MIN, Math.round(px)));
}
