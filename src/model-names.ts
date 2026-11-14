// Display names for Bedrock model ids. Upstream names models from ids such as
// "claude-sonnet-5-5" and otherwise falls back to Claude Code's own label,
// which for Bedrock ids ("us.anthropic.claude-sonnet-5-5",
// "us.anthropic.claude-haiku-4-5-20251001-v1:0") is often just "Sonnet" or
// "Opus". This parses the Bedrock form and uses upstream's naming style
// ("Sonnet 5.5", "Opus 4.6 (1M)").

const BEDROCK_MODEL_ID =
  /^(?:[a-z]+\.)?anthropic\.claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:-v\d+(?::\d+)?)?(\[1m\])?$/;

export function bedrockModelDisplayName(model: string): string | null {
  const match = BEDROCK_MODEL_ID.exec(model);
  if (!match) return null;
  const [, family = "", major, minor, oneMillionContext] = match;
  const name = `${family.charAt(0).toUpperCase()}${family.slice(1)}`;
  const version = minor === undefined ? major : `${major}.${minor}`;
  return `${name} ${version}${oneMillionContext ? " (1M)" : ""}`;
}

type ListedModel = { model?: unknown; displayName?: unknown };

/** A model/list result with Bedrock ids named; other entries unchanged. */
export function nameBedrockModels<T>(result: T): T {
  if (result === null || typeof result !== "object") return result;
  const rename = (models: unknown) =>
    Array.isArray(models)
      ? models.map((entry: ListedModel) => {
          const name = typeof entry?.model === "string" ? bedrockModelDisplayName(entry.model) : null;
          return name === null ? entry : { ...entry, displayName: name };
        })
      : models;
  const record = result as Record<string, unknown>;
  return { ...record, models: rename(record.models), selectedOnlyModels: rename(record.selectedOnlyModels) } as T;
}
