import { afterAll, expect, test } from "bun:test";
import { heuristic, strategies } from "../src/strategy";
import type { Config, Thresholds } from "../src/config";

const t: Thresholds = { long_chars: 32000, many_messages: 12, premium_score: 2 };
const hCfg = { strategy: { name: "heuristic", thresholds: t } } as Config;
const tools = [{ type: "function", function: { name: "bash" } }];
const msg = (role: string, content: unknown) => ({ role, content });
const body = (messages: any[], withTools = true) => ({ messages, ...(withTools ? { tools } : {}) });

// --- heuristic ---

test("no tools -> cheap (title/summary utility calls)", async () => {
  expect(await heuristic(body([msg("user", "refactor the architecture of everything")], false), hCfg)).toBe("cheap");
});

test("short simple request -> cheap", async () => {
  expect(await heuristic(body([msg("user", "add a comment here")]), hCfg)).toBe("cheap");
});

test("long context -> premium", async () => {
  expect(await heuristic(body([msg("user", "x".repeat(32001))]), hCfg)).toBe("premium");
});

test("exact long_chars boundary is not over", async () => {
  expect(await heuristic(body([msg("system", "y".repeat(31990)), msg("user", "hi".repeat(5))]), hCfg)).toBe("cheap");
});

test("one premium keyword alone -> cheap (score 1 < 2)", async () => {
  expect(await heuristic(body([msg("user", "please refactor this function")]), hCfg)).toBe("cheap");
});

test("two premium keywords -> premium", async () => {
  expect(await heuristic(body([msg("user", "refactor this and fix the race condition")]), hCfg)).toBe("premium");
});

test("cheap keywords pull long conversation below threshold", async () => {
  const msgs = Array.from({ length: 13 }, (_, i) => msg(i % 2 ? "assistant" : "user", "ok"));
  msgs.push(msg("user", "rename these variables and fix the typo, review it"));
  expect(await heuristic(body(msgs), hCfg)).toBe("cheap");
});

test("deep conversation + one premium keyword -> premium", async () => {
  const msgs = Array.from({ length: 13 }, (_, i) => msg(i % 2 ? "assistant" : "user", "ok"));
  msgs.push(msg("user", "debug this failing thing"));
  expect(await heuristic(body(msgs), hCfg)).toBe("premium");
});

test("block-array content is flattened", async () => {
  const content = [{ type: "text", text: "refactor the" }, { type: "text", text: " architecture" }];
  expect(await heuristic(body([msg("user", content)]), hCfg)).toBe("premium");
});

test("keyword scan uses last user message, not assistant text", async () => {
  const msgs = [msg("user", "hi"), msg("assistant", "should I refactor the architecture and debug the security?"), msg("user", "no, just fix the typo")];
  expect(await heuristic(body(msgs), hCfg)).toBe("cheap");
});

// --- llm-classifier (mock upstream) ---

let reply: () => Response | Promise<Response> = () => Response.json({});
let fetches = 0;
const mock = Bun.serve({
  port: 0,
  fetch: async () => {
    fetches++;
    return reply();
  },
});
afterAll(() => mock.stop(true));

const classifier = strategies["llm-classifier"]!;
const cCfg = (timeout_ms = 3000) =>
  ({
    providers: { openai: { baseURL: `${mock.url}v1`, apiKey: "k" } },
    strategy: { name: "llm-classifier", classifier: { target: "openai/gpt-4.1-nano", timeout_ms }, thresholds: t },
  }) as Config;
const say = (content: string) => Response.json({ choices: [{ message: { content } }] });
const simple = body([msg("user", "please refactor this function")]); // heuristic says cheap (1 keyword)

test("classifier premium verdict wins over heuristic", async () => {
  reply = () => say("premium");
  expect(await classifier(simple, cCfg())).toBe("premium");
});

test("classifier output is trimmed + lowercased", async () => {
  reply = () => say(" Cheap\n");
  expect(await classifier(simple, cCfg())).toBe("cheap");
});

test("garbage output -> heuristic fallback", async () => {
  reply = () => say("dunno, maybe both?");
  expect(await classifier(body([msg("user", "refactor this and review the security")]), cCfg())).toBe("premium"); // heuristic: 2 keywords
});

test("500 -> heuristic fallback", async () => {
  reply = () => new Response("boom", { status: 500 });
  expect(await classifier(simple, cCfg())).toBe("cheap");
});

test("timeout -> heuristic fallback", async () => {
  reply = async () => {
    await Bun.sleep(200);
    return say("premium");
  };
  expect(await classifier(simple, cCfg(50))).toBe("cheap");
});

test("no-tools body -> cheap with zero classifier calls", async () => {
  fetches = 0;
  expect(await classifier(body([msg("user", "summarize this session")], false), cCfg())).toBe("cheap");
  expect(fetches).toBe(0);
});
