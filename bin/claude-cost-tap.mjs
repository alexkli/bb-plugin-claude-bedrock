#!/usr/bin/env node
// Runs Claude Code (argv[2], with the remaining arguments) with stdin, stderr
// and stdout passed through unchanged, and watches its stream-json stdout for
// result messages. For each one whose total_cost_usd grew, it appends a line
// to the Bedrock cost ledger
// ($XDG_STATE_HOME/claude-bedrock/cost.jsonl, default ~/.local/state/...):
//   { t: epoch ms, src: "bb-claude-code", acct: <credential>, key: <session id>:<pid>, usd: <running list-price USD> }
// The ledger is shared with the Claude Bedrock ACP provider plugin and other
// tools; the plugin's usage entry sums it. Ledger failures never touch the stream.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [claude, ...args] = process.argv.slice(2);
const LEDGER_DIR = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "claude-bedrock");

// the Bedrock credential, as the ledger names it (same as accountId in ledger.ts)
const ACCT = (() => {
  const key = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  if (key) return `key:${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
  const profile = process.env.AWS_PROFILE?.trim();
  return profile ? `profile:${profile}` : "aws-chain";
})();
// Synchronous, before the chunk goes on: the plugin's provider bridge reads the
// ledger when it reports the result to bb (the session cost in the
// context-window popup), so the line must be there first.
const record = (entry) => {
  try {
    mkdirSync(LEDGER_DIR, { recursive: true });
    appendFileSync(join(LEDGER_DIR, "cost.jsonl"), `${JSON.stringify(entry)}\n`);
  } catch {
    // never touch the stream
  }
};

const child = spawn(claude, args, { stdio: ["inherit", "pipe", "inherit"] });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

const lastCost = new Map();
let pending = "";
child.stdout.on("data", (chunk) => {
  pending += chunk.toString("utf8");
  let newline = pending.indexOf("\n");
  while (newline >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    newline = pending.indexOf("\n");
    if (!line.includes('"result"') || !line.includes("total_cost_usd")) continue;
    try {
      const message = JSON.parse(line);
      const usd = message.total_cost_usd;
      if (message.type !== "result" || typeof usd !== "number" || typeof message.session_id !== "string") continue;
      const key = `${message.session_id}:${process.pid}`;
      if (lastCost.get(key) === usd) continue;
      lastCost.set(key, usd);
      record({ t: Date.now(), src: "bb-claude-code", acct: ACCT, key, usd });
    } catch {
      // not a complete JSON line: ignore
    }
  }
  process.stdout.write(chunk);
});

child.on("error", (error) => {
  process.stderr.write(`claude-bedrock: could not start ${claude}: ${error.message}\n`);
  process.exit(127);
});
// "close": after Claude Code exited and its stdout ended; then exit once ours is flushed
child.on("close", (code, signal) => {
  const finish = () => {
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    } else process.exit(code ?? 0);
  };
  if (process.stdout.writableLength > 0) process.stdout.once("drain", finish);
  else finish();
});
