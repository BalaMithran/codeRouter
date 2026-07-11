import type { Thresholds } from "./config";

export type Pick = "cheap" | "premium";
// M3 slot: an llm-classifier strategy is just another function with this signature,
// selected by strategy.name in coderouter.yaml.
export type RoutingStrategy = (body: any, t: Thresholds) => Pick;

const PREMIUM = ["refactor", "architect", "design", "debug", "race condition", "deadlock", "security", "migrate", "optimize", "concurrency", "performance", "review"];
const CHEAP = ["rename", "format", "typo", "boilerplate", "comment", "docstring", "lint", "import", "reword", "summarize"];

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b?.text === "string" ? b.text : "")).join("");
  return "";
}

export const heuristic: RoutingStrategy = (body, t) => {
  const messages: any[] = body?.messages ?? [];
  // no tools = OpenCode utility call (title/summary generation) — never worth premium
  if (!body?.tools?.length) return "cheap";

  let score = 0;
  const totalChars = messages.reduce((n, m) => n + textOf(m.content).length, 0);
  if (totalChars > t.long_chars) score += 2;
  if (messages.length > t.many_messages) score += 1;

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = textOf(lastUser?.content).toLowerCase();
  const hits = (words: string[]) => Math.min(words.filter((w) => text.includes(w)).length, 2);
  score += hits(PREMIUM);
  score -= hits(CHEAP);

  return score >= t.premium_score ? "premium" : "cheap";
};

export const strategies: Record<string, RoutingStrategy> = { heuristic };
