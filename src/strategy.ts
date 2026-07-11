import type { Config } from "./config";

export type Pick = "cheap" | "premium";
export type RoutingStrategy = (body: any, cfg: Config) => Promise<Pick>;

const PREMIUM = ["refactor", "architect", "design", "debug", "race condition", "deadlock", "security", "migrate", "optimize", "concurrency", "performance", "review"];
const CHEAP = ["rename", "format", "typo", "boilerplate", "comment", "docstring", "lint", "import", "reword", "summarize"];

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b?.text === "string" ? b.text : "")).join("");
  return "";
}

function lastUserText(body: any): string {
  const lastUser = [...(body?.messages ?? [])].reverse().find((m: any) => m.role === "user");
  return textOf(lastUser?.content);
}

export const heuristic: RoutingStrategy = async (body, cfg) => {
  const t = cfg.strategy.thresholds;
  const messages: any[] = body?.messages ?? [];
  // no tools = OpenCode utility call (title/summary generation) — never worth premium
  if (!body?.tools?.length) return "cheap";

  let score = 0;
  const totalChars = messages.reduce((n, m) => n + textOf(m.content).length, 0);
  if (totalChars > t.long_chars) score += 2;
  if (messages.length > t.many_messages) score += 1;

  const text = lastUserText(body).toLowerCase();
  const hits = (words: string[]) => Math.min(words.filter((w) => text.includes(w)).length, 2);
  score += hits(PREMIUM);
  score -= hits(CHEAP);

  return score >= t.premium_score ? "premium" : "cheap";
};

const PROMPT =
  'Classify the coding request as "cheap" (simple edit, rename, formatting, small question) or "premium" (architecture, debugging, refactoring, multi-file reasoning). Reply with exactly one word: cheap or premium.';

const llmClassifier: RoutingStrategy = async (body, cfg) => {
  if (!body?.tools?.length) return "cheap"; // utility calls: never burn a classifier call
  const { target, timeout_ms = 3000 } = cfg.strategy.classifier!; // presence validated at config load
  const slash = target.indexOf("/");
  const provider = cfg.providers[target.slice(0, slash)]!;
  try {
    const res = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: target.slice(slash + 1),
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: lastUserText(body).slice(0, 2000) },
        ],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeout_ms),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const pick = (await res.json()).choices?.[0]?.message?.content?.trim().toLowerCase();
    if (pick === "cheap" || pick === "premium") return pick;
    throw new Error(`unexpected output: ${JSON.stringify(pick)}`);
  } catch (e) {
    console.log(`[classifier] fallback to heuristic (${e instanceof Error ? e.message : e})`);
    return heuristic(body, cfg);
  }
};

export const strategies: Record<string, RoutingStrategy> = { heuristic, "llm-classifier": llmClassifier };
