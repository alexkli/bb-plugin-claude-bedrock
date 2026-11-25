// Claude Code on AWS Bedrock as its own bb provider ("claude-bedrock"), next to
// bb's normal Claude Code provider.
//
// vendor/provider-claude-code is bb's built-in Claude Code provider, copied
// verbatim (see vendor/UPSTREAM and scripts/sync-upstream.sh) with minimal
// additions for promptOnSandboxEscape. This file runs that plugin with a
// slightly changed plugin API instead of patching its server.ts, so an
// upstream sync stays straightforward:
// - providers.register: own id, name, icon and sign-in copy; no claude.ai
//   usage, guided sign-in, OAuth token passthrough or fast mode; forwards
//   plugin-kept Claude Code settings and promptOnSandboxEscape via
//   deriveProviderOptions;
// - settings.define: intercepted and kept by this plugin (src/settings.ts),
//   rendered in its own Claude Code section alongside AWS Bedrock, Usage, and
//   Additional options sections in app.tsx;
// - rpc.register: dropped. Upstream only registers its claude.ai usage source,
//   which reports on bb's built-in provider, not this one. This plugin
//   registers its own: estimated Bedrock spend from the cost ledger, plus the
//   settings RPC for app.tsx.
// Bedrock itself is plain Claude Code configuration: this plugin gives the
// provider CLAUDE_CODE_USE_BEDROCK, AWS_REGION and bin/claude-bedrock as the
// claude executable, which sets the API key (from the 0600 secret file or the
// keychain; never through bb's env, which bb records) and runs the real one.
import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import upstream from "./vendor/provider-claude-code/server";
import { appContract, type SettingsView } from "./src/contract";
import { bedrockDeclaration, DISPLAY_NAME, PROVIDER_ID } from "./src/declaration";
import { accountId } from "./src/ledger";
import { readSecretApiKey, SettingsStore, writeSecretApiKey } from "./src/settings";
import { registerBedrockUsage } from "./src/usage";

type Declaration = Parameters<BbPluginApi["providers"]["register"]>[0];

const KEYCHAIN_SERVICE = "claude-bedrock-token";
const PACKAGE_NAME = "bb-plugin-claude-bedrock";
const PLUGIN_ID = "claude-bedrock";

/** This plugin's root: the nearest folder up from the bundle with our package.json. */
function findPluginDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && readFileSync(manifest, "utf8").includes(`"${PACKAGE_NAME}"`)) return dir;
    dir = dirname(dir);
  }
  return null;
}

/** `target` with some members replaced; everything else reads through, bound to `target`. */
function withOverrides<T extends object>(target: T, overrides: Partial<Record<keyof T, unknown>>): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (Object.hasOwn(overrides, prop)) return overrides[prop as keyof T];
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === "function" ? value.bind(obj) : value;
    },
  });
}

/** The first executable claude in the usual install locations, then PATH. */
function findClaude(): string | null {
  const dirs = [
    join(homedir(), ".local", "bin"),
    join(homedir(), ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH ?? "").split(delimiter),
  ].filter(Boolean);
  for (const dir of new Set(dirs)) {
    const candidate = join(dir, process.platform === "win32" ? "claude.exe" : "claude");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // next
    }
  }
  return null;
}

/** The Bedrock API key from the macOS keychain item claude-bedrock-token, if any. */
function keychainToken(): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-a", process.env.USER ?? "", "-s", KEYCHAIN_SERVICE, "-w"],
      { timeout: 5000, encoding: "utf8" },
      (error, stdout) => resolve(error ? null : stdout.trim() || null),
    );
  });
}

export default async function plugin(bb: BbPluginApi) {
  const settings = new SettingsStore(bb);
  await settings.load();

  upstream(
    withOverrides(bb, {
      providers: withOverrides(bb.providers, {
        register: (declaration: Declaration) =>
          bb.providers.register(
            bedrockDeclaration(declaration, {
              claudeSettings: () => settings.claudeValues(),
              promptOnSandboxEscape: () => settings.bedrock().promptOnSandboxEscape,
            }),
          ),
      }),
      settings: withOverrides(bb.settings, {
        // Keep upstream's settings ourselves so app.tsx renders them in their own section.
        define: (descriptors: Record<string, unknown>) => {
          settings.setClaudeDescriptors(descriptors);
          return {
            get: async () => settings.claudeValues(),
            experimental_set: async (values: Record<string, unknown>) => {
              for (const [key, value] of Object.entries(values)) {
                if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                  await settings.setClaude(key, value);
                }
              }
              return settings.claudeValues();
            },
            onChange: (listener: () => void) => settings.onChange(listener),
          };
        },
      }),
      rpc: withOverrides(bb.rpc, { register: () => undefined }),
    }),
  );

  const pluginDir = findPluginDir();

  // 0600 file for the secret Bedrock API key (same path bb uses for secret
  // settings, so existing keys stay intact and are deleted if the plugin is removed).
  async function secretKeyPath(): Promise<string> {
    let dataDir = bb.server.experimental_dataDir || process.env.BB_DATA_DIR || join(homedir(), ".bb");
    if (!bb.server.experimental_dataDir) {
      try {
        const config = await bb.sdk.system.config();
        if (config.dataDir.length > 0) dataDir = config.dataDir;
      } catch {
        // keep the default
      }
    }
    return join(dataDir, "plugins", bb.pluginId || PLUGIN_ID, "secrets", "apiKey");
  }

  async function settingsView(): Promise<SettingsView> {
    const apiKey = await readSecretApiKey(await secretKeyPath());
    return {
      bedrock: settings.bedrock(),
      apiKeySet: apiKey !== null,
      claudeFields: settings.claudeFields,
      claudeValues: settings.claudeValues(),
    };
  }

  bb.rpc.register(appContract, {
    getSettings: () => settingsView(),
    setBedrockSettings: async (patch) => {
      await settings.setBedrock(patch);
      return settingsView();
    },
    setApiKey: async ({ apiKey }) => {
      await writeSecretApiKey(await secretKeyPath(), apiKey);
      return settingsView();
    },
    setClaudeSetting: async ({ key, value }) => {
      await settings.setClaude(key, value);
      return settingsView();
    },
  });

  registerBedrockUsage(
    bb,
    PROVIDER_ID,
    DISPLAY_NAME,
    async () => {
      const { monthlyBudgetUsd, priceFactor } = settings.bedrock();
      return { monthlyBudgetUsd, priceFactor };
    },
    async () => {
      const { apiKey, profile } = await credentials();
      return accountId(apiKey, profile);
    },
  );

  async function credentials(): Promise<{
    apiKey: string | null;
    source: string;
    region: string;
    profile: string;
  }> {
    const current = settings.bedrock();
    const region = current.region || "us-east-1";
    const profile = current.awsProfile;
    const fromFile = await readSecretApiKey(await secretKeyPath());
    if (fromFile) return { apiKey: fromFile, source: "API key from the plugin settings", region, profile };
    const fromKeychain = await keychainToken();
    if (fromKeychain) {
      return { apiKey: fromKeychain, source: `API key from the keychain (${KEYCHAIN_SERVICE})`, region, profile };
    }
    return { apiKey: null, source: profile ? `AWS profile ${profile}` : "AWS credential chain", region, profile };
  }

  // Never the key itself: bb reports contributed values as-is in each
  // thread's provider.env-resolved event, which it stores. bin/claude-bedrock
  // reads the key from the secret file or the keychain instead.
  bb.providers.experimental_contributeEnv(PROVIDER_ID, async () => {
    const current = settings.bedrock();
    const region = current.region || "us-east-1";
    const profile = current.awsProfile;
    const claude = findClaude();
    const keyPath = await secretKeyPath();
    const hasFileKey = (await readSecretApiKey(keyPath)) !== null;
    const env = [
      { name: "CLAUDE_CODE_USE_BEDROCK", value: "1", reason: "Run Claude Code against Amazon Bedrock" },
      { name: "AWS_REGION", value: region, reason: "Bedrock region from the plugin settings" },
    ];
    if (hasFileKey) {
      env.push({ name: "CLAUDE_BEDROCK_KEY_FILE", value: keyPath, reason: "Bedrock API key (0600 secret file)" });
    } else {
      env.push({ name: "CLAUDE_BEDROCK_KEYCHAIN_SERVICE", value: KEYCHAIN_SERVICE, reason: "Bedrock API key from the macOS keychain, if present" });
    }
    if (profile) env.push({ name: "AWS_PROFILE", value: profile, reason: "AWS profile from the plugin settings" });
    const factor = current.priceFactor > 0 ? current.priceFactor : 1;
    env.push({ name: "CLAUDE_BEDROCK_PRICE_FACTOR", value: String(factor), reason: "Price factor for the session cost in the context-window popup" });
    // Provider env wins over machine env, which keeps a machine-wide wrapper
    // meant for bb's own Claude Code provider (e.g. one that switches backends)
    // out of here. bin/claude-bedrock sets the API key, runs the real claude
    // and records its cost for the usage entry.
    const wrapper = pluginDir === null ? null : join(pluginDir, "bin", "claude-bedrock");
    if (wrapper !== null && existsSync(wrapper)) {
      env.push({ name: "BB_CLAUDE_CODE_EXECUTABLE", value: wrapper, reason: "Claude Code with the Bedrock API key and cost recording" });
      if (claude) env.push({ name: "CLAUDE_BEDROCK_CLAUDE", value: claude, reason: "Plain Claude Code for Bedrock" });
    } else {
      bb.log.warn(`bin/claude-bedrock not found; Claude Code runs without the Bedrock API key (AWS credential chain only)`);
      if (claude) env.push({ name: "BB_CLAUDE_CODE_EXECUTABLE", value: claude, reason: "Plain Claude Code for Bedrock" });
    }
    return env;
  });

  bb.providers.experimental_contributeEnvHealth(PROVIDER_ID, async () => {
    const { source, region } = await credentials();
    return { label: "AWS Bedrock", statusMessage: `${region}, ${source}` };
  });
}
