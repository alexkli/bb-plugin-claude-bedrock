import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LedgerCosts, SessionCostState, withSessionCost } from "../src/session-cost";

const SESSION = "0b7c3f4e-1d2a-4b5c-8d9e-0f1a2b3c4d5e";
const identity = JSON.stringify({ jsonrpc: "2.0", method: "thread/identity", params: { threadId: "thr_a", providerThreadId: SESSION } });
const delta = (deltas: unknown[]) => JSON.stringify({ jsonrpc: "2.0", method: "thread/delta", params: { threadId: "thr_a", deltas } });
const contextWindow = { kind: "contextWindow", used: 1000, size: 200000, estimated: true, attach: "open" };

describe("session cost in the context-window popup", () => {
  it("sums a session's latest running cost per process, reading only new ledger lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-cost-"));
    const file = join(dir, "cost.jsonl");
    writeFileSync(file, `${JSON.stringify({ t: 1, key: `${SESSION}:100`, usd: 0.5 })}\n${JSON.stringify({ t: 2, key: `${SESSION}:100`, usd: 1.25 })}\n`);
    const costs = new LedgerCosts(file);
    expect(costs.costOf(SESSION)).toBe(1.25);
    appendFileSync(file, `${JSON.stringify({ t: 3, key: `${SESSION}:200`, usd: 0.25 })}\n${JSON.stringify({ t: 4, key: "other:1", usd: 9 })}\n`);
    expect(costs.costOf(SESSION)).toBe(1.5);
    expect(costs.costOf("unknown")).toBeNull();
    expect(new LedgerCosts(join(dir, "missing.jsonl")).costOf(SESSION)).toBeNull();
  });

  it("adds the cost, times the thread's price factor, to contextWindow deltas once the session is known", () => {
    const state = new SessionCostState();
    const costOf = (id: string) => (id === SESSION ? 2 : null);
    const line = delta([contextWindow, { kind: "turn.open" }]);
    expect(withSessionCost(line, state, costOf)).toBe(line); // session not known yet
    expect(withSessionCost(identity, state, costOf)).toBe(identity);
    state.noteRequest(JSON.stringify({ id: 1, method: "turn/start", params: { threadId: "thr_a", options: { envVars: { CLAUDE_BEDROCK_PRICE_FACTOR: "0.8" } } } }));
    const out = JSON.parse(withSessionCost(line, state, costOf));
    expect(out.params.deltas[0].cost).toEqual({ amount: 1.6, currency: "USD" });
    expect(out.params.deltas[1].cost).toBeUndefined();
  });

  it("leaves other lines, sessions without ledger lines and invalid factors alone", () => {
    const state = new SessionCostState();
    withSessionCost(identity, state, () => null);
    const line = delta([contextWindow]);
    expect(withSessionCost(line, state, () => null)).toBe(line);
    state.noteRequest(JSON.stringify({ params: { threadId: "thr_a", options: { envVars: { CLAUDE_BEDROCK_PRICE_FACTOR: "nope" } } } }));
    expect(JSON.parse(withSessionCost(line, state, () => 3)).params.deltas[0].cost).toEqual({ amount: 3, currency: "USD" });
    const other = JSON.stringify({ jsonrpc: "2.0", method: "thread/delta", params: { threadId: "thr_a", deltas: [{ kind: "turn.open" }] } });
    expect(withSessionCost(other, state, () => 3)).toBe(other);
    expect(withSessionCost("not json", state, () => 3)).toBe("not json");
  });
});
