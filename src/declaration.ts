import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { BUDGET_SETTINGS } from "./usage";

type Declaration = Parameters<BbPluginApi["providers"]["register"]>[0];
type Descriptors = Parameters<BbPluginApi["settings"]["define"]>[0];

export const PROVIDER_ID = "claude-bedrock";
export const DISPLAY_NAME = "Claude Code (Bedrock)";

export const BEDROCK_SETTINGS = {
  apiKey: {
    type: "string",
    secret: true,
    label: "Bedrock API key",
    description:
      'Amazon Bedrock API key. Optional: without it, the plugin uses the macOS keychain item "claude-bedrock-token" if present, else the normal AWS credential chain (AWS profile, SSO, ...).',
  },
  region: {
    type: "string",
    label: "AWS region",
    description: "Bedrock region, e.g. us-east-1 or us-west-2.",
    default: "us-east-1",
  },
  awsProfile: {
    type: "string",
    label: "AWS profile",
    description: "Optional AWS profile for the AWS credential chain, used when no API key is set.",
  },
  claudeExecutable: {
    type: "string",
    label: "Claude Code executable",
    description:
      "Optional full path of the claude binary for this provider. Default: the first claude in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin or PATH. A machine-wide BB_CLAUDE_CODE_EXECUTABLE (meant for bb's own Claude Code provider) is not used.",
  },
  ...BUDGET_SETTINGS,
} as const satisfies Descriptors;

/**
 * bb's Claude Code provider declaration, turned into this provider's. Everything
 * not listed here (capabilities, reasoning levels, native roots, provider
 * options) stays as upstream declares it.
 */
export function bedrockDeclaration(upstream: Declaration): Declaration {
  const declaration: Record<string, unknown> = { ...upstream };
  // internal flag for bb's own sign-in flow; Bedrock has no claude.ai sign-in
  delete declaration.internal_DO_NOT_USE_guidedSignIn;
  // fast mode is an Anthropic API service tier
  delete declaration.serviceTiers;

  const upstreamEnv = (upstream as { env?: { passthrough?: string[] } }).env;
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
  } as unknown as Declaration;
}
