#!/usr/bin/env node
// Runs Claude Code (argv[2], with the remaining arguments) with stdin, stderr
// and stdout passed through unchanged, and watches its stream-json stdout for
// result messages. For each one whose total_cost_usd grew, it appends a line
// to the Bedrock cost ledger
// ($XDG_STATE_HOME/claude-bedrock/cost.jsonl, default ~/.local/state/...):
//   { t: epoch ms, src: "bb-claude-code", key: <session id>:<pid>, usd: <running list-price USD> }
// The ledger is shared with the Claude Bedrock ACP provider plugin and other
// tools; the plugin's usage entry sums it. Ledger failures never touch the stream.
import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const [claude, ...args] = process.argv.slice(2);
const LEDGER_DIR = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "claude-bedrock");

let ledger = mkdir(LEDGER_DIR, { recursive: true }).catch(() => {});
const record = (entry) => {
  ledger = ledger.then(() => appendFile(join(LEDGER_DIR, "cost.jsonl"), `${JSON.stringify(entry)}\n`)).catch(() => {});
};

const child = spawn(claude, args, { stdio: ["inherit", "pipe", "inherit"] });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

const lastCost = new Map();
let pending = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
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
      record({ t: Date.now(), src: "bb-claude-code", key, usd });
    } catch {
      // not a complete JSON line: ignore
    }
  }
});

child.on("error", (error) => {
  process.stderr.write(`claude-bedrock: could not start ${claude}: ${error.message}\n`);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  ledger.finally(() => {
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    }
    else process.exit(code ?? 0);
  });
});
