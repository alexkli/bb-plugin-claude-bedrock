import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Declaration = Parameters<BbPluginApi["providers"]["register"]>[0];
type DeriveContext = { settings: Record<string, unknown> } & Record<string, unknown>;

export const PROVIDER_ID = "claude-bedrock";
export const DISPLAY_NAME = "Claude Code (Bedrock)";

export interface BedrockDeclarationOptions {
  claudeSettings?: () => Record<string, unknown>;
  promptOnSandboxEscape?: () => boolean;
}

/**
 * bb's Claude Code provider declaration, turned into this provider's. Everything
 * not listed here (capabilities, reasoning levels, native roots, provider
 * options) stays as upstream declares it.
 */
export function bedrockDeclaration(upstream: Declaration, options: BedrockDeclarationOptions = {}): Declaration {
  const declaration: Record<string, unknown> = { ...upstream };
  // internal flag for bb's own sign-in flow; Bedrock has no claude.ai sign-in
  delete declaration.internal_DO_NOT_USE_guidedSignIn;
  // fast mode is an Anthropic API service tier
  delete declaration.serviceTiers;

  const upstreamEnv = (upstream as { env?: { passthrough?: string[] } }).env;
  const derive = declaration.deriveProviderOptions as ((ctx: DeriveContext) => unknown) | undefined;
  return {
    ...(declaration as unknown as Declaration),
    id: PROVIDER_ID,
    displayName: DISPLAY_NAME,
    icon: "./assets/logo.svg",
    strings: {
      ...upstream.strings,
      signInHint: "Set a Bedrock API key or AWS credentials in Settings → Plugins → Claude Bedrock provider.",
      expiredHint: "Bedrock rejected the credentials. Update them in the Claude Bedrock provider settings, then reload.",
    },
    // health and installation checks stay; the usage check reads claude.ai limits
    maintenance: { ...upstream.maintenance, usage: false },
    capabilities: { ...upstream.capabilities, supportsServiceTier: false },
    // a claude.ai OAuth token must not reach Bedrock threads
    env: {
      ...upstreamEnv,
      passthrough: (upstreamEnv?.passthrough ?? []).filter((name) => name !== "CLAUDE_CODE_OAUTH_TOKEN"),
    },
    // Upstream reads its settings only here; give it the plugin-kept values
    // plus our promptOnSandboxEscape option.
    ...(derive
      ? {
          deriveProviderOptions: (ctx: DeriveContext) => ({
            ...(derive({
              ...ctx,
              settings: { ...ctx.settings, ...(options.claudeSettings?.() ?? {}) },
            }) as Record<string, unknown>),
            promptOnSandboxEscape: options.promptOnSandboxEscape?.() ?? false,
          }),
        }
      : {}),
  } as unknown as Declaration;
}
