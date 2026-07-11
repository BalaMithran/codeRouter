import { expect, test } from "bun:test";
import { resolve } from "../src/router";
import type { Config } from "../src/config";

const cfg: Config = {
  default_provider: "openai",
  providers: { openai: { baseURL: "https://api.openai.com/v1", apiKey: "k" }, ollama: { baseURL: "http://localhost:11434/v1" } },
  virtual_models: { cheap: "openai/gpt-4.1-mini", premium: "openai/gpt-4.1", offline: "ollama/llama3.1:8b", auto: "auto" },
  strategy: { name: "heuristic", thresholds: { long_chars: 32000, many_messages: 12, premium_score: 2 } },
};
const tools = [{ type: "function" }];

test("virtual: cheap -> openai gpt-4.1-mini", async () => {
  expect(await resolve("cheap", {}, cfg)).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
});

test("virtual: offline -> ollama, colon in model id intact", async () => {
  expect(await resolve("offline", {}, cfg)).toEqual({ provider: "ollama", model: "llama3.1:8b" });
});

test("auto: simple request routes cheap", async () => {
  expect((await resolve("auto", { messages: [{ role: "user", content: "fix typo" }], tools }, cfg)).model).toBe("gpt-4.1-mini");
});

test("auto: complex request routes premium", async () => {
  expect((await resolve("auto", { messages: [{ role: "user", content: "refactor the architecture" }], tools }, cfg)).model).toBe("gpt-4.1");
});

test("explicit provider prefix: openai/gpt-4.1 stripped", async () => {
  expect(await resolve("openai/gpt-4.1", {}, cfg)).toEqual({ provider: "openai", model: "gpt-4.1" });
});

test("explicit prefix splits on first slash only", async () => {
  expect(await resolve("ollama/some/model:tag", {}, cfg)).toEqual({ provider: "ollama", model: "some/model:tag" });
});

test("bare id -> default provider, id untouched (M1 back-compat)", async () => {
  expect(await resolve("gpt-4.1-mini", {}, cfg)).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
});

test("unknown prefix -> default provider, full id untouched", async () => {
  expect(await resolve("foo/bar", {}, cfg)).toEqual({ provider: "openai", model: "foo/bar" });
});
