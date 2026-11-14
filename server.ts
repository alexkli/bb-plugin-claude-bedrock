// Claude Code on AWS Bedrock as its own bb provider ("claude-bedrock"), next to
// bb's normal Claude Code provider.
//
// vendor/provider-claude-code is bb's built-in Claude Code provider, copied
// verbatim (see vendor/UPSTREAM and scripts/sync-upstream.sh). This file runs
// that plugin with a slightly changed plugin API instead of patching it, so an
// upstream sync is a folder replace:
// - providers.register: own id, name, icon and sign-in copy; no claude.ai
//   usage, guided sign-in, OAuth token passthrough or fast mode;
// - settings.define: the Bedrock settings come first, then Claude Code's own;
// - rpc.register: dropped. Upstream only registers its claude.ai usage source,
//   which reports on bb's built-in provider, not this one.
// Bedrock itself is plain Claude Code configuration: this plugin gives the
// provider CLAUDE_CODE_USE_BEDROCK, AWS_REGION, credentials and a plain claude
// executable as environment.
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import upstream from "./vendor/provider-claude-code/server";
import { bedrockDeclaration, BEDROCK_SETTINGS, PROVIDER_ID } from "./src/declaration";

type Declaration = Parameters<BbPluginApi["providers"]["register"]>[0];
type SettingsHandle = ReturnType<BbPluginApi["settings"]["define"]>;

const KEYCHAIN_SERVICE = "claude-bedrock-token";

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

export default function plugin(bb: BbPluginApi) {
  let settings: SettingsHandle | null = null;

  upstream(
    withOverrides(bb, {
      providers: withOverrides(bb.providers, {
        register: (declaration: Declaration) => bb.providers.register(bedrockDeclaration(declaration)),
      }),
      settings: withOverrides(bb.settings, {
        define: (descriptors: Parameters<BbPluginApi["settings"]["define"]>[0]) => {
          settings = bb.settings.define({ ...BEDROCK_SETTINGS, ...descriptors });
          return settings;
        },
      }),
      rpc: withOverrides(bb.rpc, { register: () => undefined }),
    }),
  );
  // Upstream always defines its settings; define ours if a future version stops.
  const handle = settings ?? bb.settings.define(BEDROCK_SETTINGS);

  async function credentials(): Promise<{
    apiKey: string | null;
    source: string;
    region: string;
    profile: string;
    claude: string | null;
  }> {
    const values = (await handle.get()) as Record<string, unknown>;
    const text = (name: string) => (typeof values[name] === "string" ? (values[name] as string).trim() : "");
    const region = text("region") || "us-east-1";
    const profile = text("awsProfile");
    const claude = text("claudeExecutable") || findClaude();
    const fromSettings = text("apiKey");
    if (fromSettings) return { apiKey: fromSettings, source: "API key from the plugin settings", region, profile, claude };
    const fromKeychain = await keychainToken();
    if (fromKeychain) {
      return { apiKey: fromKeychain, source: `API key from the keychain (${KEYCHAIN_SERVICE})`, region, profile, claude };
    }
    return { apiKey: null, source: profile ? `AWS profile ${profile}` : "AWS credential chain", region, profile, claude };
  }

  bb.providers.experimental_contributeEnv(PROVIDER_ID, async () => {
    const { apiKey, region, profile, claude } = await credentials();
    const env = [
      { name: "CLAUDE_CODE_USE_BEDROCK", value: "1", reason: "Run Claude Code against Amazon Bedrock" },
      { name: "AWS_REGION", value: region, reason: "Bedrock region from the plugin settings" },
    ];
    if (apiKey) env.push({ name: "AWS_BEARER_TOKEN_BEDROCK", value: apiKey, reason: "Bedrock API key" });
    if (profile) env.push({ name: "AWS_PROFILE", value: profile, reason: "AWS profile from the plugin settings" });
    // provider env wins over machine env: keep a machine-wide wrapper meant for
    // bb's own Claude Code provider (e.g. one that switches backends) out of here
    if (claude) env.push({ name: "BB_CLAUDE_CODE_EXECUTABLE", value: claude, reason: "Plain Claude Code for Bedrock" });
    return env;
  });

  bb.providers.experimental_contributeEnvHealth(PROVIDER_ID, async () => {
    const { source, region } = await credentials();
    return { label: "AWS Bedrock", statusMessage: `${region}, ${source}` };
  });
}
