// The host entry and provider bridge are bb's Claude Code ones. Threads get the
// Bedrock settings (region, credentials, Claude Code executable) from the
// environment the server contributes for this provider (see server.ts), which
// bb passes with each session.
//
// bb also sends that environment with each model/list request
// (params.envVars), but upstream's model probe runs Claude Code with the
// bridge process's own environment only, so it would list the Anthropic API
// models (or whatever a machine-wide BB_CLAUDE_CODE_EXECUTABLE wrapper
// configures). This bridge process serves only this provider, so it applies
// the request's envVars to its own environment before upstream handles it.
//
// Upstream reports no cost; the bridge adds Claude Code's session cost (times
// the price factor) to its contextWindow deltas, which bb shows as "Session
// cost" in the context-window popup (src/session-cost.ts).
//
// Upstream names models from Anthropic API ids only; for Bedrock ids it falls
// back to labels like "Sonnet". The bridge renames them in its model/list
// responses (src/model-names.ts).
import { experimental_providerBridge as upstreamBridge } from "./vendor/provider-claude-code/src/host";
import { nameBedrockModels } from "./src/model-names";
import { LedgerCosts, SessionCostState, withSessionCost } from "./src/session-cost";

export { default } from "./vendor/provider-claude-code/src/host";

// bb's context-window popup shows "Session cost" when a contextWindow delta
// carries one; upstream's never do (src/session-cost.ts)
const costs = new LedgerCosts();
const costState = new SessionCostState();

/** Ids of model/list requests whose responses are still to be written. */
const pendingModelLists = new Set<string | number>();

/** A response line to a pending model/list request, with Bedrock model names; other lines unchanged. */
export function renameModelListResponse(line: string, pending: Set<string | number>): string {
  if (pending.size === 0 || !line.startsWith("{") || !line.includes('"result"')) return line;
  try {
    const message = JSON.parse(line) as { id?: unknown; result?: unknown };
    const id = message.id;
    if ((typeof id !== "string" && typeof id !== "number") || !pending.has(id) || message.result === undefined) return line;
    pending.delete(id);
    return `${JSON.stringify({ ...message, result: nameBedrockModels(message.result) })}${line.endsWith("\n") ? "\n" : ""}`;
  } catch {
    return line;
  }
}

/** The envVars of a model/list request line, or null. */
export function modelListEnvVars(line: string): Record<string, string> | null {
  if (!line.includes('"model/list"')) return null;
  try {
    const message = JSON.parse(line) as { method?: unknown; params?: { envVars?: unknown } };
    const envVars = message.method === "model/list" ? message.params?.envVars : undefined;
    if (envVars === null || typeof envVars !== "object" || Array.isArray(envVars)) return null;
    return Object.fromEntries(
      Object.entries(envVars).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return null;
  }
}

export const experimental_providerBridge: typeof upstreamBridge = {
  ...upstreamBridge,
  start: (context) => {
    // Bedrock even before the first request carries the contributed env
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    // upstream writes each JSON-RPC message as one line through process.stdout.write
    const write = process.stdout.write.bind(process.stdout) as (chunk: unknown, ...rest: unknown[]) => boolean;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
      write(
        typeof chunk === "string"
          ? withSessionCost(renameModelListResponse(chunk, pendingModelLists), costState, (id) => costs.costOf(id))
          : chunk,
        ...rest,
      )) as typeof process.stdout.write;
    upstreamBridge.start?.(context);
  },
  handleLine: (line) => {
    costState.noteRequest(line);
    const envVars = modelListEnvVars(line);
    if (envVars !== null) {
      Object.assign(process.env, envVars);
      try {
        const id = (JSON.parse(line) as { id?: unknown }).id;
        if (typeof id === "string" || typeof id === "number") pendingModelLists.add(id);
      } catch {
        // modelListEnvVars parsed it already
      }
    }
    upstreamBridge.handleLine(line);
  },
};
