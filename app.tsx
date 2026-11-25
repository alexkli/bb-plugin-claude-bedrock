// Frontend of bb-plugin-claude-bedrock:
// - provider icon for "Claude Code (Bedrock)" (provider id claude-bedrock): the
//   Claude mark with an AWS badge of about the same size. assets/logo.svg is the
//   monochrome version (bb renders the branding icon as a single-colour shape);
//   assets/icon-color.svg and assets/icon.png (256 px, for the marketplace) are
//   this colored version. Keep them in sync.
// - settings sections: AWS Bedrock (API key, region, profile), Usage (monthly
//   budget, price factor), Claude Code (vendored provider-claude-code options),
//   and Additional options (Prompt on sandbox escape).
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { appContract, BedrockSettings, SettingField, SettingsView, SettingValue } from "./src/contract";

const CLAUDE_MARK = "M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 3.3e-05 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845 C 277.369171 87.221436 275.194641 76.590698 275.194641 63.624268 L 312.322174 13.20813 L 332.8591 6.604126 L 382.389313 13.20813 L 403.248352 31.328979 L 434.013519 101.71814 L 483.865753 212.537048 L 561.181274 363.221497 L 583.812134 407.919434 L 595.892639 449.315491 L 600.40271 461.959839 L 608.214783 461.959839 L 608.214783 454.711609 L 614.577271 369.825623 L 626.335632 265.61084 L 637.771851 131.516846 L 641.718201 93.745117 L 660.402832 48.483276 L 697.530334 24.000122 L 726.52356 37.852417 L 750.362549 72 L 747.060486 94.067139 L 732.886047 186.201416 L 705.100708 330.52356 L 686.979919 427.167847 L 697.530334 427.167847 L 709.61084 415.087341 L 758.496704 350.174561 L 840.644348 247.490051 L 876.885925 206.738342 L 919.167847 161.71814 L 946.308838 140.29541 L 997.61084 140.29541 L 1035.38269 196.429626 L 1018.469849 254.416199 L 965.637634 321.422852 L 921.825562 378.201538 L 859.006714 462.765259 L 819.785278 530.41626 L 823.409424 535.812073 L 832.75177 534.92627 L 974.657776 504.724915 L 1051.328979 490.872559 L 1142.818848 475.167786 L 1184.214844 494.496582 L 1188.724854 514.147644 L 1172.456421 554.335693 L 1074.604126 578.496765 L 959.838989 601.449829 L 788.939636 641.879272 L 786.845764 643.409485 L 789.261841 646.389343 L 866.255127 653.637634 L 899.194702 655.409424 L 979.812134 655.409424 L 1129.932861 666.604187 L 1169.154419 692.537109 L 1192.671265 724.268677 L 1188.724854 748.429688 L 1128.322144 779.194641 L 1046.818848 759.865845 L 856.590759 714.604126 L 791.355774 698.335754 L 782.335693 698.335754 L 782.335693 703.731567 L 836.69812 756.885986 L 936.322205 846.845581 L 1061.073975 962.81897 L 1067.436279 991.490112 L 1051.409424 1014.120911 L 1034.496704 1011.704712 L 924.885986 929.234924 L 882.604126 892.107544 L 786.845764 811.48999 L 780.483276 811.48999 L 780.483276 819.946289 L 802.550415 852.241699 L 919.087341 1027.409424 L 925.127625 1081.127686 L 916.671204 1098.604126 L 886.469849 1109.154419 L 853.288696 1103.114136 L 785.073914 1007.355835 L 714.684631 899.516785 L 657.906067 802.872498 L 650.979858 806.81897 L 617.476624 1167.704834 L 601.771851 1186.147705 L 565.530212 1200 L 535.328857 1177.046997 L 519.302124 1139.919556 L 535.328857 1066.550537 L 554.657776 970.792053 L 570.362488 894.68457 L 584.536926 800.134277 L 592.993347 768.724976 L 592.429626 766.630859 L 585.503479 767.516968 L 514.22821 865.369263 L 405.825531 1011.865906 L 320.053711 1103.677979 L 299.516815 1111.812256 L 263.919525 1093.369263 L 267.221497 1060.429688 L 287.114136 1031.114136 L 405.825531 880.107361 L 477.422913 786.52356 L 523.651062 732.483276 L 523.328918 724.671265 L 520.590698 724.671265 L 205.288605 929.395935 L 149.154434 936.644409 L 124.993355 914.01355 L 127.973183 876.885986 L 139.409409 864.80542 L 234.201385 799.570435 L 233.879227 799.8927 Z";

function ClaudeBedrockIcon({ className }: { className?: string }) {
  const mask = useId();
  return (
    // explicit width/height: without them WebKit (iOS app) sizes the svg at 300px
    // inside bb's min-w-max icon wrapper; the host className still overrides via CSS
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="16" height="16" className={className} aria-hidden="true">
      <defs>
        {/* the Claude mark runs under the badge; cut a gap around the badge */}
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="1200" height="1200">
          <rect width="1200" height="1200" fill="#fff" />
          <rect x="470" y="591" width="780" height="659" rx="208" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <path fill="#D97757" transform="scale(0.6667)" d={CLAUDE_MARK} />
      </g>
      {/* AWS badge, about as wide as the Claude mark, in the bottom-right corner */}
      <g transform="translate(520 641) scale(1.2143) translate(-620 -700)">
        <rect x="620" y="700" width="560" height="460" rx="130" fill="#FF9900" />
        <path d="M720 900 Q900 1050 1080 900" fill="none" stroke="#232F3E" strokeWidth="80" strokeLinecap="round" />
        <path d="M1000 860 L1095 885 L1060 975" fill="none" stroke="#232F3E" strokeWidth="64" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Settings UI

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const INPUT_CLASS =
  "flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const SELECT_CLASS =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const CLEAR_BUTTON_CLASS =
  "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input bg-transparent px-2.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-5 rounded-xl border bg-card p-5">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  badge,
  description,
  children,
}: {
  label: string;
  badge?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium leading-snug">{label}</span>
          {badge ? (
            <span className="rounded border px-1.5 py-0.5 text-[10px] font-normal leading-none text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {description ? <span className="text-xs leading-relaxed text-muted-foreground">{description}</span> : null}
      </div>
      <div className="w-full shrink-0 sm:w-64">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5 text-sm">
        <span className="font-medium leading-snug">{label}</span>
        {description ? <span className="text-xs leading-relaxed text-muted-foreground">{description}</span> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-foreground" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/** Text or number input that saves on blur / Enter. */
function CommitInput({
  value,
  resetKey,
  type,
  placeholder,
  step,
  min,
  disabled,
  onCommit,
}: {
  value: string;
  resetKey?: number;
  type: "text" | "number";
  placeholder?: string;
  step?: string;
  min?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, resetKey]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className={INPUT_CLASS}
      type={type}
      autoComplete="off"
      placeholder={placeholder}
      step={step}
      min={min}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

/** Write-only secret input: never displays the stored value; saves on blur / Enter, Clear unsets it. */
function SecretInput({
  isSet,
  disabled,
  onSave,
  onClear,
}: {
  isSet: boolean;
  disabled: boolean;
  onSave: (value: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed.length > 0) {
      setDraft("");
      onSave(trimmed);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input
        className={INPUT_CLASS}
        type="password"
        autoComplete="off"
        placeholder={isSet ? "[set]" : "[not set]"}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {isSet ? (
        <button type="button" className={CLEAR_BUTTON_CLASS} disabled={disabled} onClick={onClear}>
          Clear
        </button>
      ) : null}
    </div>
  );
}

/** One of the wrapped Claude Code provider's settings, rendered from its descriptor. */
function ClaudeField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: SettingField;
  value: SettingValue | undefined;
  disabled: boolean;
  onChange: (value: SettingValue) => void;
}) {
  if (field.type === "boolean") {
    return (
      <ToggleRow
        label={field.label}
        description={field.description}
        checked={value === true}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }
  return (
    <SettingRow label={field.label} description={field.description}>
      {field.type === "select" ? (
        <select
          className={SELECT_CLASS}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {field.optionLabels?.[option] ?? option}
            </option>
          ))}
        </select>
      ) : (
        <CommitInput
          type={field.type === "number" ? "number" : "text"}
          value={value === undefined ? "" : String(value)}
          disabled={disabled}
          onCommit={(next) => onChange(field.type === "number" ? Number(next) : next)}
        />
      )}
    </SettingRow>
  );
}

function SettingsSection() {
  const rpc = useRpc<typeof appContract>();
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [saveSeq, setSaveSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(() => {
    rpc.call("getSettings").then(
      (view) => {
        setSettings(view);
        setSaveSeq((n) => n + 1);
        setError(null);
      },
      (cause: unknown) => setError(errorText(cause)),
    );
  }, [rpc]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const save = (action: () => Promise<SettingsView>) => {
    setBusy(true);
    action()
      .then(
        (next) => {
          setSettings(next);
          setSaveSeq((n) => n + 1);
          setError(null);
        },
        (cause: unknown) => setError(errorText(cause)),
      )
      .finally(() => setBusy(false));
  };

  const setBedrock = (patch: Partial<BedrockSettings>) => save(() => rpc.call("setBedrockSettings", patch));
  const setApiKey = (apiKey: string | null) => save(() => rpc.call("setApiKey", { apiKey }));
  const setClaude = (key: string, value: SettingValue) => save(() => rpc.call("setClaudeSetting", { key, value }));

  if (settings === null) {
    return error ? <p className="text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const { bedrock } = settings;

  return (
    <div className="flex flex-col gap-8">
      <Section title="AWS Bedrock">
        <SettingRow
          label="Bedrock API key"
          badge="secret"
          description='Amazon Bedrock API key. Optional: without it, the plugin uses the macOS keychain item "claude-bedrock-token" if present, else the normal AWS credential chain (AWS profile, SSO, ...).'
        >
          <SecretInput
            isSet={settings.apiKeySet}
            disabled={busy}
            onSave={(key) => setApiKey(key)}
            onClear={() => setApiKey(null)}
          />
        </SettingRow>
        <SettingRow label="AWS region" description="Bedrock region, e.g. us-east-1 or us-west-2.">
          <CommitInput
            type="text"
            value={bedrock.region}
            resetKey={saveSeq}
            placeholder="us-east-1"
            disabled={busy}
            onCommit={(region) => setBedrock({ region })}
          />
        </SettingRow>
        <SettingRow
          label="AWS profile"
          description="Optional AWS profile for the AWS credential chain, used when no API key is set."
        >
          <CommitInput
            type="text"
            value={bedrock.awsProfile}
            resetKey={saveSeq}
            disabled={busy}
            onCommit={(awsProfile) => setBedrock({ awsProfile })}
          />
        </SettingRow>
      </Section>

      <Section title="Usage">
        <SettingRow
          label="Monthly budget (USD)"
          description="Scale for the usage bar. Today's bar uses this budget divided by the days in the month."
        >
          <CommitInput
            type="number"
            step="any"
            min="0.01"
            value={String(bedrock.monthlyBudgetUsd)}
            resetKey={saveSeq}
            disabled={busy}
            onCommit={(raw) => {
              const monthlyBudgetUsd = Number(raw);
              if (Number.isFinite(monthlyBudgetUsd) && monthlyBudgetUsd > 0) setBedrock({ monthlyBudgetUsd });
              else setError("Monthly budget must be a positive number.");
            }}
          />
        </SettingRow>
        <SettingRow
          label="Price factor"
          description="Multiplier on Claude Code's list-price cost estimate, for a negotiated Bedrock discount or markup (e.g. 0.8 for 20% below list). 1 shows list price."
        >
          <CommitInput
            type="number"
            step="any"
            min="0.01"
            value={String(bedrock.priceFactor)}
            resetKey={saveSeq}
            disabled={busy}
            onCommit={(raw) => {
              const priceFactor = Number(raw);
              if (Number.isFinite(priceFactor) && priceFactor > 0) setBedrock({ priceFactor });
              else setError("Price factor must be a positive number.");
            }}
          />
        </SettingRow>
      </Section>

      {settings.claudeFields.length > 0 ? (
        <Section
          title="Claude Code"
          description="Standard bb Claude Code provider options, for this provider only. Changes apply to new turns."
        >
          {settings.claudeFields.map((field) => (
            <ClaudeField
              key={field.key}
              field={field}
              value={settings.claudeValues[field.key]}
              disabled={busy}
              onChange={(value) => setClaude(field.key, value)}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Additional options">
        <ToggleRow
          label="Prompt on sandbox escape"
          description={
            <>
              Pass <code>Bash(dangerouslyDisableSandbox:true)</code> as an ask rule when the Claude Code sandbox is active, so Approve for me mode asks for confirmation instead of letting the auto-mode classifier approve unsandboxed retries.
            </>
          }
          checked={bedrock.promptOnSandboxEscape === true}
          disabled={busy}
          onChange={(checked) => setBedrock({ promptOnSandboxEscape: checked })}
        />
      </Section>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_providerIcon({ providerKind: "agent", providerId: "claude-bedrock", icon: ClaudeBedrockIcon });
  app.slots.settingsSection({
    id: "bedrock",
    component: SettingsSection,
  });
});
