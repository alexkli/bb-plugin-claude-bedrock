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
import { experimental_providerBridge as upstreamBridge } from "./vendor/provider-claude-code/src/host";

export { default } from "./vendor/provider-claude-code/src/host";

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
    upstreamBridge.start?.(context);
  },
  handleLine: (line) => {
    const envVars = modelListEnvVars(line);
    if (envVars !== null) Object.assign(process.env, envVars);
    upstreamBridge.handleLine(line);
  },
};
