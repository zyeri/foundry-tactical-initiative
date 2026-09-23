/**
 * @file Await a UI callback and report any failure instead of dropping it. No
 * Foundry globals are required; the default reporter uses `ui.notifications`
 * only when it exists.
 */

/** Receives a failed callback's label and error. */
export type ErrorReporter = (label: string, error: unknown) => void;

/** Log to the console and, inside Foundry, show an error notification. */
const defaultReport: ErrorReporter = (label, error) => {
  console.error(`tactical-initiative | ${label}`, error);
  const notes = (globalThis as { ui?: { notifications?: { error?: (msg: string) => void } } }).ui
    ?.notifications;
  notes?.error?.(`Tactical Initiative: ${label} failed; see console (F12).`);
};

/**
 * Run `fn` (sync or async) and report a throw or rejection. Never rejects.
 *
 * @param label - Short diagnostic label.
 * @param fn - The callback.
 * @param report - Failure sink; defaults to console + notification.
 * @returns Resolves when `fn` settles.
 */
export function runSafe(label: string, fn: () => unknown, report: ErrorReporter = defaultReport): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(
      () => undefined,
      (error: unknown) => {
        report(label, error);
      }
    );
}
