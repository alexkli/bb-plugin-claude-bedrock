import { describe, expect, it } from "vitest";
import { bedrockModelDisplayName, nameBedrockModels } from "../src/model-names";

describe("bedrockModelDisplayName", () => {
  it.each([
    ["us.anthropic.claude-fable-5-2", "Fable 5.2"],
    ["us.anthropic.claude-sonnet-5-5", "Sonnet 5.5"],
    ["us.anthropic.claude-sonnet-5", "Sonnet 5"],
    ["us.anthropic.claude-sonnet-4-6[1m]", "Sonnet 4.6 (1M)"],
    ["us.anthropic.claude-opus-4-1-20250805-v1:0", "Opus 4.1"],
    ["us.anthropic.claude-opus-4-6-v1[1m]", "Opus 4.6 (1M)"],
    ["us.anthropic.claude-haiku-4-5-20251001-v1:0", "Haiku 4.5"],
    ["eu.anthropic.claude-opus-5-5", "Opus 5.5"],
    ["global.anthropic.claude-sonnet-5-5", "Sonnet 5.5"],
    ["anthropic.claude-opus-5-5", "Opus 5.5"],
  ])("%s -> %s", (id, name) => {
    expect(bedrockModelDisplayName(id)).toBe(name);
  });

  it("leaves other ids alone", () => {
    expect(bedrockModelDisplayName("opus")).toBeNull();
    expect(bedrockModelDisplayName("claude-opus-5-5")).toBeNull();
    expect(bedrockModelDisplayName("arn:aws:bedrock:us-west-2:123:application-inference-profile/x")).toBeNull();
  });

  it("renames models and selected-only models in a model/list result", () => {
    const result = {
      models: [{ model: "us.anthropic.claude-sonnet-5-5", displayName: "Sonnet", isDefault: true }],
      selectedOnlyModels: [{ model: "opus", displayName: "Opus alias" }],
    };
    expect(nameBedrockModels(result)).toEqual({
      models: [{ model: "us.anthropic.claude-sonnet-5-5", displayName: "Sonnet 5.5", isDefault: true }],
      selectedOnlyModels: [{ model: "opus", displayName: "Opus alias" }],
    });
  });
});
