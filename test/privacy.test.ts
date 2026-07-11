import { afterAll, expect, test } from "bun:test";
import { globToRegex, type Config } from "../src/config";
import { resolve } from "../src/router";

// --- globToRegex units (the security boundary) ---

test("/auth/** matches filePath in tool args JSON", () => {
  const body = JSON.stringify({ messages: [{ role: "assistant", tool_calls: [{ function: { arguments: '{"filePath":"/Users/x/proj/auth/login.ts"}' } }] }] });
  expect(globToRegex("/auth/**").test(body)).toBe(true);
});

test("**/secrets/** matches bash command string", () => {
  expect(globToRegex("**/secrets/**").test('{"command":"cat config/secrets/api.txt"}')).toBe(true);
});

test("prose about authentication does not match /auth/**", () => {
  expect(globToRegex("/auth/**").test('{"content":"explain authentication concepts to me"}')).toBe(false);
});

test("single * stops at path segment; ** crosses segments", () => {
  const one = globToRegex("/auth/*/keys");
  const many = globToRegex("/auth/**/keys");
  expect(one.test("/auth/prod/keys")).toBe(true);
  expect(one.test("/auth/a/b/keys")).toBe(false);
  expect(many.test("/auth/prod/keys")).toBe(true);
  expect(many.test("/auth/a/b/keys")).toBe(true);
});

// Regression: E2E leak — OpenCode sends RELATIVE paths; rules must not require a leading slash.
test("**/secrets/** matches relative path in prose", () => {
  expect(globToRegex("**/secrets/**").test('{"content":"read the file secrets/token.txt and tell me"}')).toBe(true);
});

test("/auth/** matches relative filePath in tool args", () => {
  expect(globToRegex("/auth/**").test('{\\"filePath\\":\\"auth/login.ts\\"}')).toBe(true);
});

test("dots are literal", () => {
  const re = globToRegex("**/.env*");
  expect(re.test("/proj/.env.local")).toBe(true);
  expect(re.test("/proj/xenv")).toBe(false);
});

// --- resolve precedence ---

const mock = Bun.serve({ port: 0, fetch: () => { classifierHit = true; return Response.json({ choices: [{ message: { content: "premium" } }] }); } });
let classifierHit = false;
afterAll(() => mock.stop(true));

const cfg: Config = {
  default_provider: "openai",
  providers: { openai: { baseURL: `${mock.url}v1`, apiKey: "k" }, ollama: { baseURL: "http://localhost:11434/v1" } },
  virtual_models: { cheap: "openai/gpt-4.1-mini", premium: "openai/gpt-4.1", auto: "auto" },
  strategy: { name: "llm-classifier", classifier: { target: "openai/nano" }, thresholds: { long_chars: 32000, many_messages: 12, premium_score: 2 } },
  privacy: { target: "ollama/llama3.1:8b", paths: ["/auth/**"], patterns: [globToRegex("/auth/**")] },
};
const tainted = { messages: [{ role: "user", content: "read /auth/login.ts please" }], tools: [{}] };

test("explicit premium + matching body -> forced local with privacy flag", async () => {
  expect(await resolve("premium", tainted, cfg)).toEqual({ provider: "ollama", model: "llama3.1:8b", privacy: true });
});

test("explicit openai/gpt-4.1 + matching body -> still forced local", async () => {
  expect((await resolve("openai/gpt-4.1", tainted, cfg)).provider).toBe("ollama");
});

test("privacy configured but body clean -> normal route", async () => {
  expect(await resolve("cheap", { messages: [{ role: "user", content: "hi" }] }, cfg)).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
});

test("no privacy section -> unchanged behavior", async () => {
  const noPriv = { ...cfg, privacy: undefined };
  expect((await resolve("premium", tainted, noPriv)).provider).toBe("openai");
});

test("ordering invariant: auto + matching body never hits classifier", async () => {
  classifierHit = false;
  const route = await resolve("auto", tainted, cfg);
  expect(route.provider).toBe("ollama");
  expect(route.privacy).toBe(true);
  expect(classifierHit).toBe(false); // matched content must not leak to the classifier
});
