import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accountId, forAccount } from "../src/ledger";

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
      env: { ...process.env, XDG_STATE_HOME: dir, AWS_BEARER_TOKEN_BEDROCK: "test-key", AWS_PROFILE: "" },
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`args:--print hi\n${lines.join("\n")}\n`);

    const ledger = readFileSync(join(dir, "claude-bedrock", "cost.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(ledger.map((e) => e.usd)).toEqual([0.5, 1.25]);
    expect(ledger.every((e) => e.src === "bb-claude-code" && e.key.startsWith("s1:"))).toBe(true);
    expect(ledger.every((e) => e.acct === accountId("test-key", null))).toBe(true);
  });

  it("records a result's cost before passing the result on", () => {
    const dir = mkdtempSync(join(tmpdir(), "cost-tap-order-"));
    const result = JSON.stringify({ type: "result", session_id: "s2", total_cost_usd: 0.75 });
    const fake = join(dir, "fake-claude");
    writeFileSync(fake, `#!/bin/sh\necho '${result}'\n`);
    chmodSync(fake, 0o755);
    // the reader sees the result line, then checks the ledger right away
    const reader = join(dir, "reader.mjs");
    writeFileSync(
      reader,
      `import { readFileSync } from "node:fs";
process.stdin.once("data", () => {
  let ledger = "";
  try { ledger = readFileSync(process.argv[2], "utf8"); } catch {}
  process.stdout.write(ledger.includes('"usd":0.75') ? "recorded" : "missing");
  process.exit(0);
});`,
    );
    const ledger = join(dir, "claude-bedrock", "cost.jsonl");
    const run = spawnSync("/bin/sh", ["-c", `"${process.execPath}" "${TAP}" "${fake}" | "${process.execPath}" "${reader}" "${ledger}"`], {
      env: { ...process.env, XDG_STATE_HOME: dir },
      encoding: "utf8",
    });
    expect(run.stdout).toBe("recorded");
  });

  it("exits with the child's status", () => {
    const run = spawnSync(process.execPath, [TAP, "/bin/sh", "-c", "exit 3"], { encoding: "utf8" });
    expect(run.status).toBe(3);
  });
});

describe("accountId", () => {
  it("fingerprints an API key without containing it", () => {
    const id = accountId("  secret-api-key ", "ignored");
    expect(id).toMatch(/^key:[0-9a-f]{12}$/);
    expect(id).not.toContain("secret");
    expect(id).toBe(accountId("secret-api-key", null));
  });
  it("falls back to the profile, then the AWS chain", () => {
    expect(accountId(null, "work")).toBe("profile:work");
    expect(accountId("", "")).toBe("aws-chain");
  });
  it("counts a credential's lines and older lines without acct", () => {
    const entries = [
      { t: 1, key: "a", usd: 1 },
      { t: 2, key: "b", usd: 2, acct: "key:aaaaaaaaaaaa" },
      { t: 3, key: "c", usd: 3, acct: "profile:work" },
    ];
    expect(forAccount(entries, "key:aaaaaaaaaaaa").map((e) => e.key)).toEqual(["a", "b"]);
  });
});
