import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TAP = join(__dirname, "..", "bin", "claude-cost-tap.mjs");

describe("claude-cost-tap", () => {
  it("passes stdout through and records growing result costs per session", () => {
    const dir = mkdtempSync(join(tmpdir(), "cost-tap-"));
    const lines = [
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "result", session_id: "s1", total_cost_usd: 0.5 },
      { type: "result", session_id: "s1", total_cost_usd: 0.5 },
      { type: "result", session_id: "s1", total_cost_usd: 1.25 },
    ].map((line) => JSON.stringify(line));
    const fake = join(dir, "fake-claude");
    writeFileSync(fake, `#!/bin/sh\necho "args:$*"\ncat <<'X'\n${lines.join("\n")}\nX\n`);
    chmodSync(fake, 0o755);

    const run = spawnSync(process.execPath, [TAP, fake, "--print", "hi"], {
      env: { ...process.env, XDG_STATE_HOME: dir },
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`args:--print hi\n${lines.join("\n")}\n`);

    const ledger = readFileSync(join(dir, "claude-bedrock", "cost.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(ledger.map((e) => e.usd)).toEqual([0.5, 1.25]);
    expect(ledger.every((e) => e.src === "bb-claude-code" && e.key.startsWith("s1:"))).toBe(true);
  });

  it("exits with the child's status", () => {
    const run = spawnSync(process.execPath, [TAP, "/bin/sh", "-c", "exit 3"], { encoding: "utf8" });
    expect(run.status).toBe(3);
  });
});
