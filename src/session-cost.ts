// Session cost for bb's context-window popup ("Session cost"). bb's Claude Code
// bridge reports no cost, so the host bridge adds it to the bridge's
// contextWindow deltas on their way to bb: Claude Code's running list-price
// cost of the thread's session, from the Bedrock cost ledger
// (bin/claude-cost-tap.mjs records it before the bridge sees each result),
// times the price factor the thread's commands carry
// (CLAUDE_BEDROCK_PRICE_FACTOR in their envVars).
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LEDGER_FILE = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "claude-bedrock", "cost.jsonl");

/**
 * Reads the ledger incrementally: only lines appended since the last call.
 * Each key is one session in one process with a running total, so a session's
 * cost is the sum of its keys' latest values.
 */
export class LedgerCosts {
  private offset = 0;
  private rest = "";
  private readonly byKey = new Map<string, number>();

  constructor(private readonly file: string = LEDGER_FILE) {}

  /** The session's list-price USD so far, or null when the ledger has none. */
  costOf(sessionId: string): number | null {
    this.refresh();
    let total = 0;
    let found = false;
    for (const [key, usd] of this.byKey) {
      if (key === sessionId || key.startsWith(`${sessionId}:`)) {
        total += usd;
        found = true;
      }
    }
    return found ? total : null;
  }

  private refresh(): void {
    let size: number;
    try {
      size = statSync(this.file).size;
    } catch {
      return;
    }
    if (size < this.offset) {
      // replaced or truncated: read it again
      this.offset = 0;
      this.rest = "";
      this.byKey.clear();
    }
    if (size === this.offset) return;
    const fd = openSync(this.file, "r");
    try {
      const buffer = Buffer.alloc(size - this.offset);
      const read = readSync(fd, buffer, 0, buffer.length, this.offset);
      this.offset += read;
      const lines = (this.rest + buffer.subarray(0, read).toString("utf8")).split("\n");
      this.rest = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { key?: unknown; usd?: unknown };
          if (typeof entry.key === "string" && typeof entry.usd === "number") this.byKey.set(entry.key, entry.usd);
        } catch {
          // not a ledger line
        }
      }
    } finally {
      closeSync(fd);
    }
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Per-thread state the bridge learns from the lines it reads and writes. */
export class SessionCostState {
  readonly sessions = new Map<string, string>();
  readonly priceFactors = new Map<string, number>();

  /** Learns a thread's price factor from a bb -> bridge request (params.threadId, params.options.envVars). */
  noteRequest(line: string): void {
    if (!line.includes("CLAUDE_BEDROCK_PRICE_FACTOR")) return;
    try {
      const params = (JSON.parse(line) as { params?: unknown }).params;
      if (!isObject(params) || typeof params.threadId !== "string") return;
      const envVars = isObject(params.options) && isObject(params.options.envVars) ? params.options.envVars : null;
      const factor = Number(envVars?.CLAUDE_BEDROCK_PRICE_FACTOR);
      if (Number.isFinite(factor) && factor > 0) this.priceFactors.set(params.threadId, factor);
    } catch {
      // not JSON
    }
  }
}

/**
 * A bridge -> bb line with the session cost added to its contextWindow deltas;
 * thread/identity lines teach the thread's session id. Other lines unchanged.
 */
export function withSessionCost(line: string, state: SessionCostState, costOf: (sessionId: string) => number | null): string {
  const identity = line.includes('"thread/identity"');
  if (!identity && !(line.includes('"thread/delta"') && line.includes('"contextWindow"'))) return line;
  try {
    const message = JSON.parse(line) as { method?: unknown; params?: unknown };
    const params = isObject(message.params) ? message.params : null;
    const threadId = typeof params?.threadId === "string" ? params.threadId : null;
    if (params === null || threadId === null) return line;
    if (message.method === "thread/identity") {
      if (typeof params.providerThreadId === "string") state.sessions.set(threadId, params.providerThreadId);
      return line;
    }
    if (message.method !== "thread/delta" || !Array.isArray(params.deltas)) return line;
    const sessionId = state.sessions.get(threadId);
    const listPrice = sessionId === undefined ? null : costOf(sessionId);
    if (listPrice === null) return line;
    const amount = listPrice * (state.priceFactors.get(threadId) ?? 1);
    let changed = false;
    for (const delta of params.deltas) {
      if (isObject(delta) && delta.kind === "contextWindow" && delta.cost === undefined) {
        delta.cost = { amount, currency: "USD" };
        changed = true;
      }
    }
    return changed ? `${JSON.stringify(message)}${line.endsWith("\n") ? "\n" : ""}` : line;
  } catch {
    return line;
  }
}
