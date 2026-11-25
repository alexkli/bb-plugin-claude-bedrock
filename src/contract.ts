import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const settingValueSchema = z.union([z.string().max(10_000), z.number(), z.boolean()]);
export type SettingValue = z.infer<typeof settingValueSchema>;

/** A serializable copy of a declared setting (the vendored Claude Code provider's). */
export const settingFieldSchema = z.object({
  key: z.string().min(1),
  type: z.enum(["boolean", "string", "number", "select"]),
  label: z.string(),
  description: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  optionLabels: z.record(z.string(), z.string()).nullable(),
  default: settingValueSchema.nullable(),
});
export type SettingField = z.infer<typeof settingFieldSchema>;

export const bedrockSettingsSchema = z
  .object({
    region: z.string().trim().max(100),
    awsProfile: z.string().trim().max(200),
    monthlyBudgetUsd: z.number().finite().positive().max(1_000_000),
    priceFactor: z.number().finite().positive().max(100),
    promptOnSandboxEscape: z.boolean(),
  })
  .strict();
export type BedrockSettings = z.infer<typeof bedrockSettingsSchema>;

export const settingsViewSchema = z.object({
  bedrock: bedrockSettingsSchema,
  apiKeySet: z.boolean(),
  claudeFields: z.array(settingFieldSchema),
  claudeValues: z.record(z.string(), settingValueSchema),
});
export type SettingsView = z.infer<typeof settingsViewSchema>;

/** Frontend <-> server settings RPC contract. */
export const appContract = defineRpcContract({
  getSettings: { input: z.null(), output: settingsViewSchema },
  setBedrockSettings: { input: bedrockSettingsSchema.partial().strict(), output: settingsViewSchema },
  setApiKey: {
    input: z.object({ apiKey: z.string().max(10_000).nullable() }).strict(),
    output: settingsViewSchema,
  },
  setClaudeSetting: {
    input: z.object({ key: z.string().min(1).max(100), value: settingValueSchema }).strict(),
    output: settingsViewSchema,
  },
});
