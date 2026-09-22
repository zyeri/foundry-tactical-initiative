import { describe, expect, it } from "vitest";
import { runSafe } from "../src/ui/run-safe";

describe("runSafe", () => {
  it("reports an async rejection with its label", async () => {
    const seen: [string, unknown][] = [];
    await runSafe("group", async () => {
      throw new Error("boom");
    }, (label, error) => seen.push([label, error]));
    expect(seen[0]?.[0]).toBe("group");
    expect((seen[0]?.[1] as Error).message).toBe("boom");
  });
  it("reports a synchronous throw", async () => {
    const seen: string[] = [];
    await runSafe("sync", () => {
      throw new Error("x");
    }, (label) => seen.push(label));
    expect(seen).toEqual(["sync"]);
  });
  it("does not report success", async () => {
    const seen: string[] = [];
    await runSafe("ok", async () => 1, (label) => seen.push(label));
    expect(seen).toEqual([]);
  });
});
