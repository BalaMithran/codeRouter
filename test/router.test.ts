import { expect, test } from "bun:test";
import { resolve } from "../src/router";
import type { Config } from "../src/config";

const cfg: Config = {
  default_provider: "openai",
  providers: { openai: { baseURL: "https://api.openai.com/v1", apiKey: "k" }, ollama: { baseURL: "http://localhost:11434/v1" } },
  virtual_models: { cheap: "openai/gpt-4.1-mini", premium: "openai/gpt-4.1", offline: "ollama/qwen2.5-coder:7b", auto: "auto" },
  strategy: { name: "heuristic", thresholds: { long_chars: 32000, many_messages: 12, premium_score: 2 } },
};
const tools = [{ type: "function" }];

test("virtual: cheap -> openai gpt-4.1-mini", () => {
  expect(resolve("cheap", {}, cfg)).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
});

test("virtual: offline -> ollama, model id with slash-free colon intact", () => {
  expect(resolve("offline", {}, cfg)).toEqual({ provider: "ollama", model: "qwen2.5-coder:7b" });
});

test("auto: simple request routes cheap", () => {
  expect(resolve("auto", { messages: [{ role: "user", content: "fix typo" }], tools }, cfg).model).toBe("gpt-4.1-mini");
});

test("auto: complex request routes premium", () => {
  expect(resolve("auto", { messages: [{ role: "user", content: "refactor the architecture" }], tools }, cfg).model).toBe("gpt-4.1");
});

test("explicit provider prefix: openai/gpt-4.1 stripped", () => {
  expect(resolve("openai/gpt-4.1", {}, cfg)).toEqual({ provider: "openai", model: "gpt-4.1" });
});

test("explicit prefix splits on first slash only", () => {
  expect(resolve("ollama/some/model:tag", {}, cfg)).toEqual({ provider: "ollama", model: "some/model:tag" });
});

test("bare id -> default provider, id untouched (M1 back-compat)", () => {
  expect(resolve("gpt-4.1-mini", {}, cfg)).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
});

test("unknown prefix -> default provider, full id untouched", () => {
  expect(resolve("foo/bar", {}, cfg)).toEqual({ provider: "openai", model: "foo/bar" });
});
