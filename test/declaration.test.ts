import { describe, expect, it } from "vitest";
import upstream from "../vendor/provider-claude-code/server";
import { bedrockDeclaration, BEDROCK_SETTINGS, PROVIDER_ID } from "../src/declaration";

// Runs the vendored upstream server against a recording plugin API, so a sync
// that changes what upstream registers shows up here.
function captureUpstream() {
  const registered: Record<string, unknown>[] = [];
  const settings: Record<string, unknown>[] = [];
  let rpcCalls = 0;
  const bb = {
    providers: { register: (d: Record<string, unknown>) => (registered.push(d), { dispose() {} }) },
    settings: { define: (d: Record<string, unknown>) => (settings.push(d), { get: async () => ({}), onChange() {} }) },
    rpc: { register: () => void rpcCalls++ },
    sdk: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
  upstream(bb as never);
  return { registered, settings, rpcCalls };
}

describe("upstream shape", () => {
  it("registers one provider, defines settings once and registers only its usage RPC", () => {
    const { registered, settings, rpcCalls } = captureUpstream();
    expect(registered).toHaveLength(1);
    expect(registered[0]?.id).toBe("claude-code");
    expect(settings).toHaveLength(1);
    expect(rpcCalls).toBe(1);
  });

  it("has no setting names that collide with the Bedrock ones", () => {
    const { settings } = captureUpstream();
    for (const name of Object.keys(BEDROCK_SETTINGS)) expect(settings[0]).not.toHaveProperty(name);
  });
});

describe("bedrockDeclaration", () => {
  const { registered } = captureUpstream();
  const upstreamDeclaration = registered[0] as never;
  const declaration = bedrockDeclaration(upstreamDeclaration) as unknown as Record<string, any>;

  it("renames the provider and keeps upstream behavior", () => {
    expect(declaration.id).toBe(PROVIDER_ID);
    expect(declaration.displayName).toBe("Claude Code (Bedrock)");
    expect(declaration.icon).toBe("./assets/logo.svg");
    expect(declaration.reasoningLevels).toEqual((upstreamDeclaration as any).reasoningLevels);
    expect(declaration.deriveProviderOptions).toBe((upstreamDeclaration as any).deriveProviderOptions);
    expect(declaration.capabilities.permissionModes).toEqual((upstreamDeclaration as any).capabilities.permissionModes);
  });

  it("drops claude.ai-only parts", () => {
    expect(declaration).not.toHaveProperty("internal_DO_NOT_USE_guidedSignIn");
    expect(declaration).not.toHaveProperty("serviceTiers");
    expect(declaration.capabilities.supportsServiceTier).toBe(false);
    expect(declaration.maintenance.usage).toBe(false);
    expect(declaration.env.passthrough).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(declaration.env.passthrough).toContain("BB_CLAUDE_CODE_EXECUTABLE");
  });
});

import { modelListEnvVars } from "../host";

describe("modelListEnvVars", () => {
  it("returns the string envVars of a model/list request", () => {
    const line = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "model/list", params: { envVars: { A: "1", B: 2 } } });
    expect(modelListEnvVars(line)).toEqual({ A: "1" });
  });
  it("ignores other methods and bad lines", () => {
    expect(modelListEnvVars(JSON.stringify({ method: "thread/start", params: { envVars: { A: "1" } } }))).toBeNull();
    expect(modelListEnvVars('{"method":"model/list"')).toBeNull();
    expect(modelListEnvVars(JSON.stringify({ method: "model/list", params: {} }))).toBeNull();
  });
});

import { renameModelListResponse } from "../host";

describe("renameModelListResponse", () => {
  it("renames only responses to pending model/list requests", () => {
    const pending = new Set<string | number>([7]);
    const response = `${JSON.stringify({ jsonrpc: "2.0", id: 7, result: { models: [{ model: "us.anthropic.claude-fable-5-2", displayName: "Fable" }], selectedOnlyModels: [] } })}\n`;
    const other = `${JSON.stringify({ jsonrpc: "2.0", id: 8, result: { models: [{ model: "us.anthropic.claude-fable-5-2", displayName: "Fable" }] } })}\n`;
    expect(renameModelListResponse(other, pending)).toBe(other);
    const renamed = renameModelListResponse(response, pending);
    expect(JSON.parse(renamed).result.models[0].displayName).toBe("Fable 5.2");
    expect(renamed.endsWith("\n")).toBe(true);
    expect(pending.size).toBe(0);
  });
});
