// Estimated Bedrock spend in bb's Provider usage panel and footer, from the
// Bedrock cost ledger (see ledger.ts): this month and today, against a monthly
// budget, scaled by the price factor. bb's provider-usage plugin discovers the
// source through the RPC methods below.
// Same as the usage entry in bb-plugin-acp-claude-bedrock: keep them in sync.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { parseLedger, totals } from "./ledger";

const LEDGER = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "claude-bedrock", "cost.jsonl");
const LIST_RESOURCES = "provider-usage.v1.listResources";
const GET_RESOURCE = "provider-usage.v1.getResource";

const window = z.object({
  kind: z.enum(["five-hour", "daily", "weekly", "custom"]),
  id: z.string().min(1),
  label: z.string().min(1),
  usedPercent: z.number().nonnegative(),
  resetsAt: z.string().nullable(),
  model: z.string().nullable(),
  cost: z.object({ usedUsdCents: z.number().nonnegative(), limitUsdCents: z.number().positive() }).nullable(),
});
const common = { plan: z.null(), accountEmail: z.string().nullable(), planLabel: z.string().nullable() };
const usageState = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), ...common, windows: z.array(window) }),
  z.object({ status: z.literal("error"), ...common, message: z.string() }),
]);

export const usageRpcContract = defineRpcContract({
  [LIST_RESOURCES]: {
    input: z.object({}),
    output: z.object({
      resources: z.array(z.object({
        accountKey: z.string().min(1).nullable(),
        id: z.string().min(1),
        providerId: z.string().min(1),
        label: z.string().min(1),
        scope: z.object({ kind: z.literal("host"), hostId: z.string().min(1), hostName: z.string().min(1) }),
      })),
    }),
  },
  [GET_RESOURCE]: {
    input: z.object({ resourceId: z.string().min(1), refresh: z.boolean() }),
    output: z.object({ accountKey: z.string().min(1).nullable(), observedAt: z.number().int().nonnegative().nullable(), usage: usageState }),
  },
});

const cents = (usd: number) => Math.round(usd * 100);
const usd = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

export const BUDGET_SETTINGS = {
  monthlyBudgetUsd: {
    type: "number",
    label: "Monthly budget (USD)",
    description: "Scale for the usage bar. Today's bar uses this budget divided by the days in the month.",
    default: 100,
  },
  priceFactor: {
    type: "number",
    label: "Price factor",
    description:
      "Multiplier on Claude Code's list-price cost estimate, for a negotiated Bedrock discount or markup (e.g. 0.8 for 20% below list). 1 shows list price.",
    default: 1,
  },
} as const;

export function registerBedrockUsage(
  bb: BbPluginApi,
  providerId: string,
  label: string,
  readBudget: () => Promise<{ monthlyBudgetUsd: number; priceFactor: number }>,
  /** Ledger sources (src) this entry counts. */
  sources: readonly string[],
): void {
  bb.rpc.register(usageRpcContract, {
    [LIST_RESOURCES]: async () => {
      // the ledger lives on this machine: publish it for the bb server's own host
      const [hosts, config] = await Promise.all([bb.sdk.hosts.list(), bb.sdk.system.config().catch(() => null)]);
      const connected = hosts.filter((host) => host.status === "connected");
      const host = connected.find((h) => h.id === config?.primaryHostId) ?? connected[0];
      return {
        resources: host === undefined ? [] : [{
          accountKey: null,
          id: host.id,
          providerId,
          label,
          scope: { kind: "host" as const, hostId: host.id, hostName: host.name },
        }],
      };
    },
    [GET_RESOURCE]: async () => {
      const base = { accountKey: null, observedAt: Date.now() };
      const meta = { plan: null, accountEmail: null, planLabel: "estimate" };
      let text = "";
      try {
        text = await readFile(LEDGER, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          return { ...base, usage: { status: "error" as const, ...meta, message: `Could not read ${LEDGER}.` } };
        }
      }
      const { monthlyBudgetUsd, priceFactor: factor } = await readBudget();
      const discount = factor > 0 ? factor : 1;
      const budget = monthlyBudgetUsd > 0 ? monthlyBudgetUsd : 100;
      const now = new Date();
      const t = totals(parseLedger(text).filter((e) => e.src !== undefined && sources.includes(e.src)), now);
      const month = t.month * discount;
      const today = t.today * discount;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const dailyBudget = budget / daysInMonth;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return {
        ...base,
        usage: {
          status: "ok" as const,
          ...meta,
          windows: [
            {
              kind: "custom" as const,
              id: "month",
              // the compact footer shows label + percent, so the label carries the dollars
              label: `${now.toLocaleString("en-US", { month: "short" })} ${usd(month)}`,
              usedPercent: (month / budget) * 100,
              resetsAt: nextMonth.toISOString(),
              model: null,
              cost: { usedUsdCents: cents(month), limitUsdCents: Math.max(1, cents(budget)) },
            },
            {
              kind: "custom" as const, // "daily" makes bb render the label as "1d"
              id: "today",
              label: `Today ${usd(today)}`,
              usedPercent: (today / dailyBudget) * 100,
              resetsAt: tomorrow.toISOString(),
              model: null,
              cost: { usedUsdCents: cents(today), limitUsdCents: Math.max(1, cents(dailyBudget)) },
            },
          ],
        },
      };
    },
  }, {
    experimental_discoverable: true,
    experimental_description: `Publishes estimated ${label} spend for BB's Provider Usage plugin.`,
  });
}
