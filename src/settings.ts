// Settings owned by this plugin and rendered by its settings section (not
// bb's declarative form), so the page can group AWS Bedrock, Usage, the
// wrapped Claude Code provider options, and Additional options into separate
// sections.
//
// Two groups, persisted in bb.storage.kv:
// - bedrock: this plugin's own non-secret settings (region, awsProfile,
//   monthlyBudgetUsd, priceFactor, promptOnSandboxEscape);
// - claude: the settings of the wrapped Claude Code provider
//   (vendor/provider-claude-code). Their descriptors come from it at load time
//   (so new ones from an upstream sync appear), and their values reach it
//   through deriveProviderOptions.
//
// The optional Bedrock API key is never stored in bb.storage.kv or returned to
// the frontend; it lives in a 0600 file at <dataDir>/plugins/<id>/secrets/apiKey.
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  bedrockSettingsSchema,
  type BedrockSettings,
  type SettingField,
  type SettingValue,
} from "./contract";

export const BEDROCK_DEFAULTS: BedrockSettings = {
  region: "us-east-1",
  awsProfile: "",
  monthlyBudgetUsd: 100,
  priceFactor: 1,
  promptOnSandboxEscape: false,
};

const STORAGE_KEY = "settings.v1";

type Stored = { bedrock?: Partial<BedrockSettings>; claude?: Record<string, SettingValue> };

/** A serializable field from a bb setting descriptor; null for unsupported types. */
export function toSettingField(key: string, descriptor: unknown): SettingField | null {
  const d = descriptor as Record<string, unknown>;
  const type = d.type;
  if (type !== "boolean" && type !== "string" && type !== "number" && type !== "select") return null;
  if (d.secret === true) return null; // never round-trip secrets through the frontend
  const value = d.default;
  return {
    key,
    type,
    label: typeof d.label === "string" ? d.label : key,
    description: typeof d.description === "string" ? d.description : null,
    options: Array.isArray(d.options) ? d.options.filter((o): o is string => typeof o === "string") : null,
    optionLabels:
      d.experimental_optionLabels && typeof d.experimental_optionLabels === "object"
        ? (d.experimental_optionLabels as Record<string, string>)
        : null,
    default: typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null,
  };
}

/** Read a secret API key from its 0600 file, or null if absent/empty. */
export async function readSecretApiKey(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path, "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Write a secret API key to its 0600 file, or delete the file when cleared. */
export async function writeSecretApiKey(path: string, apiKey: string | null): Promise<void> {
  const trimmed = apiKey === null ? "" : apiKey.trim();
  if (trimmed.length === 0) {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, trimmed, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

export class SettingsStore {
  private stored: Stored = {};
  private listeners = new Set<() => void>();
  claudeFields: SettingField[] = [];

  constructor(private readonly bb: Pick<BbPluginApi, "storage">) {}

  async load(): Promise<void> {
    this.stored = (await this.bb.storage.kv.get<Stored>(STORAGE_KEY)) ?? {};
  }

  setClaudeDescriptors(descriptors: Record<string, unknown>): void {
    this.claudeFields = Object.entries(descriptors)
      .map(([key, descriptor]) => toSettingField(key, descriptor))
      .filter((field): field is SettingField => field !== null);
  }

  bedrock(): BedrockSettings {
    const parsed = bedrockSettingsSchema.safeParse({ ...BEDROCK_DEFAULTS, ...this.stored.bedrock });
    return parsed.success ? parsed.data : BEDROCK_DEFAULTS;
  }

  /** Built-in Claude Code settings: defaults overlaid with stored values. Synchronous for deriveProviderOptions. */
  claudeValues(): Record<string, SettingValue> {
    const values: Record<string, SettingValue> = {};
    for (const field of this.claudeFields) {
      const stored = this.stored.claude?.[field.key];
      if (stored !== undefined) values[field.key] = stored;
      else if (field.default !== null) values[field.key] = field.default;
    }
    return values;
  }

  async setBedrock(patch: Partial<BedrockSettings>): Promise<void> {
    const next = bedrockSettingsSchema.parse({ ...this.bedrock(), ...patch });
    this.stored = {
      ...this.stored,
      bedrock: {
        ...next,
        region: next.region || BEDROCK_DEFAULTS.region,
      },
    };
    await this.save();
  }

  async setClaude(key: string, value: SettingValue): Promise<void> {
    const field = this.claudeFields.find((f) => f.key === key);
    if (!field) throw new Error(`Unknown setting: ${key}`);
    const valid =
      field.type === "boolean"
        ? typeof value === "boolean"
        : field.type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : field.type === "select"
            ? typeof value === "string" && (field.options ?? []).includes(value)
            : typeof value === "string";
    if (!valid) throw new Error(`Invalid value for ${field.label}.`);
    this.stored = { ...this.stored, claude: { ...this.stored.claude, [key]: value } };
    await this.save();
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private async save(): Promise<void> {
    await this.bb.storage.kv.set(STORAGE_KEY, this.stored);
    for (const listener of this.listeners) listener();
  }
}
