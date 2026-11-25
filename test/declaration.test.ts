import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import upstream from "../vendor/provider-claude-code/server";
import { buildSessionOptions } from "../vendor/provider-claude-code/src/bridge/session-options";
import { buildClaudeSessionParams, buildClaudeTurnParams } from "../vendor/provider-claude-code/src/session-params";
import { bedrockDeclaration, PROVIDER_ID } from "../src/declaration";
import { BEDROCK_DEFAULTS, readSecretApiKey, SettingsStore, writeSecretApiKey } from "../src/settings";
import { modelListEnvVars, renameModelListResponse } from "../host";

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
    for (const name of Object.keys(BEDROCK_DEFAULTS)) expect(settings[0]).not.toHaveProperty(name);
  });
});

describe("bedrockDeclaration", () => {
  const { registered } = captureUpstream();
  const upstreamDeclaration = registered[0] as never;
  const declaration = bedrockDeclaration(upstreamDeclaration, {
    claudeSettings: () => ({ sandboxEnabled: true, commandDescriptionsEnabled: true }),
    promptOnSandboxEscape: () => true,
  }) as unknown as Record<string, any>;

  it("renames the provider and keeps upstream behavior", () => {
    expect(declaration.id).toBe(PROVIDER_ID);
    expect(declaration.displayName).toBe("Claude Code (Bedrock)");
    expect(declaration.icon).toBe("./assets/logo.svg");
    expect(declaration.reasoningLevels).toEqual((upstreamDeclaration as any).reasoningLevels);
    expect(declaration.capabilities.permissionModes).toEqual((upstreamDeclaration as any).capabilities.permissionModes);
  });

  it("forwards plugin-kept Claude settings and promptOnSandboxEscape through deriveProviderOptions", () => {
    const options = declaration.deriveProviderOptions({ settings: {}, promptMode: "default" });
    expect(options.sandboxEnabled).toBe(true);
    expect(options.commandDescriptionsEnabled).toBe(true);
    expect(options.promptOnSandboxEscape).toBe(true);

    const planOptions = declaration.deriveProviderOptions({ settings: {}, promptMode: "plan" });
    expect(planOptions.claudeCodePermissionMode).toBe("plan");
    expect(planOptions.promptOnSandboxEscape).toBe(true);
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

describe("SettingsStore", () => {
  function memoryKv() {
    const map = new Map<string, unknown>();
    return {
      storage: {
        kv: {
          get: async <T>(key: string) => map.get(key) as T | undefined,
          set: async (key: string, value: unknown) => {
            map.set(key, value);
          },
          delete: async (key: string) => {
            map.delete(key);
          },
          list: async () => [...map.keys()],
        },
      },
    };
  }

  it("persists Bedrock and Claude settings separately and omits claudeExecutable", async () => {
    const { settings: upstreamDescriptors } = captureUpstream();
    const kv = memoryKv();
    const store = new SettingsStore(kv as never);
    await store.load();
    store.setClaudeDescriptors(upstreamDescriptors[0] ?? {});

    expect(store.bedrock()).toEqual(BEDROCK_DEFAULTS);
    expect(BEDROCK_DEFAULTS).not.toHaveProperty("claudeExecutable");
    expect(store.claudeFields.some((f) => f.key === "sandboxEnabled")).toBe(true);
    expect(store.claudeValues().sandboxEnabled).toBe(true);

    await store.setBedrock({ region: "us-west-2", monthlyBudgetUsd: 250, priceFactor: 0.85, promptOnSandboxEscape: true });
    await store.setClaude("commandDescriptionsEnabled", true);

    const reloaded = new SettingsStore(kv as never);
    await reloaded.load();
    reloaded.setClaudeDescriptors(upstreamDescriptors[0] ?? {});
    expect(reloaded.bedrock()).toEqual({
      region: "us-west-2",
      awsProfile: "",
      monthlyBudgetUsd: 250,
      priceFactor: 0.85,
      promptOnSandboxEscape: true,
    });
    expect(reloaded.claudeValues().commandDescriptionsEnabled).toBe(true);
  });

  it("normalizes empty region back to default", async () => {
    const store = new SettingsStore(memoryKv() as never);
    await store.load();
    await store.setBedrock({ region: "   " });
    expect(store.bedrock().region).toBe("us-east-1");
  });
});

describe("secret API key storage", () => {
  it("writes a 0600 file, reads it back trimmed, and deletes it on clear", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-bedrock-secret-"));
    try {
      const path = join(dir, "secrets", "apiKey");
      expect(await readSecretApiKey(path)).toBeNull();

      await writeSecretApiKey(path, "  test-bedrock-key  \n");
      expect(await readSecretApiKey(path)).toBe("test-bedrock-key");
      const info = await stat(path);
      expect(info.mode & 0o777).toBe(0o600);

      await writeSecretApiKey(path, null);
      expect(await readSecretApiKey(path)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("promptOnSandboxEscape", () => {
  it("flows through session/turn params and adds the ask rule only when sandbox is enabled", () => {
    const sessionParams = buildClaudeSessionParams({
      threadId: "thr_1",
      cwd: "/tmp/work",
      instructionMode: "append",
      options: {
        approvalReviewer: "automatic",
        permissionMode: "auto",
        permissionScope: "workspace",
        permissionEscalation: "ask",
        providerOptions: { sandboxEnabled: true, promptOnSandboxEscape: true },
      },
    });
    expect(sessionParams.promptOnSandboxEscape).toBe(true);

    const turnParams = buildClaudeTurnParams({
      threadId: "thr_1",
      providerThreadId: "ses_1",
      input: [],
      options: {
        approvalReviewer: "automatic",
        permissionMode: "auto",
        permissionScope: "workspace",
        permissionEscalation: "ask",
        providerOptions: { sandboxEnabled: true, promptOnSandboxEscape: true },
      },
    });
    expect(turnParams.promptOnSandboxEscape).toBe(true);

    const withEscapePrompt = buildSessionOptions(
      {
        cwd: "/tmp/work",
        instructionMode: "append",
        permissionMode: "auto",
        permissionScope: "workspace",
        serviceTier: "default",
        workflowsEnabled: true,
        chromeEnabled: false,
        disable1MContext: false,
        artifactsEnabled: false,
        sandboxEnabled: true,
        promptOnSandboxEscape: true,
      },
      {},
    );
    expect(withEscapePrompt.settings).toMatchObject({
      permissions: { ask: ["Bash(dangerouslyDisableSandbox:true)"] },
    });

    const withoutSandbox = buildSessionOptions(
      {
        cwd: "/tmp/work",
        instructionMode: "append",
        permissionMode: "auto",
        permissionScope: "workspace",
        serviceTier: "default",
        workflowsEnabled: true,
        chromeEnabled: false,
        disable1MContext: false,
        artifactsEnabled: false,
        sandboxEnabled: false,
        promptOnSandboxEscape: true,
      },
      {},
    );
    expect((withoutSandbox.settings as Record<string, unknown> | undefined)?.permissions).toBeUndefined();
  });
});

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
