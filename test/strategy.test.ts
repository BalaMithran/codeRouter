import { expect, test } from "bun:test";
import { heuristic } from "../src/strategy";
import type { Thresholds } from "../src/config";

const t: Thresholds = { long_chars: 32000, many_messages: 12, premium_score: 2 };
const tools = [{ type: "function", function: { name: "bash" } }];
const msg = (role: string, content: unknown) => ({ role, content });
const body = (messages: any[], withTools = true) => ({ messages, ...(withTools ? { tools } : {}) });

test("no tools -> cheap (title/summary utility calls)", () => {
  expect(heuristic(body([msg("user", "refactor the architecture of everything")], false), t)).toBe("cheap");
});

test("short simple request -> cheap", () => {
  expect(heuristic(body([msg("user", "add a comment here")]), t)).toBe("cheap");
});

test("long context -> premium", () => {
  expect(heuristic(body([msg("user", "x".repeat(32001))]), t)).toBe("premium");
});

test("exact long_chars boundary is not over", () => {
  // system+user chars sum to exactly 32000 -> not > threshold -> cheap
  expect(heuristic(body([msg("system", "y".repeat(31990)), msg("user", "hi".repeat(5))]), t)).toBe("cheap");
});

test("one premium keyword alone -> cheap (score 1 < 2)", () => {
  expect(heuristic(body([msg("user", "please refactor this function")]), t)).toBe("cheap");
});

test("two premium keywords -> premium", () => {
  expect(heuristic(body([msg("user", "refactor this and fix the race condition")]), t)).toBe("premium");
});

test("cheap keywords pull long conversation below threshold", () => {
  const msgs = Array.from({ length: 13 }, (_, i) => msg(i % 2 ? "assistant" : "user", "ok"));
  msgs.push(msg("user", "rename these variables and fix the typo, review it")); // +1 review, -2 rename/typo, +1 msgs = 0
  expect(heuristic(body(msgs), t)).toBe("cheap");
});

test("deep conversation + one premium keyword -> premium", () => {
  const msgs = Array.from({ length: 13 }, (_, i) => msg(i % 2 ? "assistant" : "user", "ok"));
  msgs.push(msg("user", "debug this failing thing"));
  expect(heuristic(body(msgs), t)).toBe("premium");
});

test("block-array content is flattened", () => {
  const content = [{ type: "text", text: "refactor the" }, { type: "text", text: " architecture" }];
  expect(heuristic(body([msg("user", content)]), t)).toBe("premium");
});

test("keyword scan uses last user message, not assistant text", () => {
  const msgs = [msg("user", "hi"), msg("assistant", "should I refactor the architecture and debug the security?"), msg("user", "no, just fix the typo")];
  expect(heuristic(body(msgs), t)).toBe("cheap");
});
