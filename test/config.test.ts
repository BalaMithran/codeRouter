import { expect, test } from "bun:test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

const dir = mkdtempSync(join(tmpdir(), "crt-"));
const write = (yaml: string) => {
  const p = join(dir, `${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(p, yaml);
  return p;
};

test("${ENV} substitution resolves", () => {
  process.env.CRT_TEST_KEY = "sekrit";
  const p = write(`default_provider: openai\nproviders:\n  openai: { baseURL: https://x, apiKey: \${CRT_TEST_KEY} }\nvirtual_models: {}\nstrategy: { name: heuristic, thresholds: { long_chars: 1, many_messages: 1, premium_score: 1 } }\n`);
  expect(loadConfig(p).providers.openai.apiKey).toBe("sekrit");
});

test("missing env var throws at load", () => {
  const p = write(`default_provider: openai\nproviders:\n  openai: { baseURL: https://x, apiKey: \${CRT_UNSET_VAR_XYZ} }\nvirtual_models: {}\nstrategy: { name: heuristic, thresholds: { long_chars: 1, many_messages: 1, premium_score: 1 } }\n`);
  expect(() => loadConfig(p)).toThrow("CRT_UNSET_VAR_XYZ");
});

test("virtual model targeting unknown provider throws", () => {
  const p = write(`default_provider: openai\nproviders:\n  openai: { baseURL: https://x }\nvirtual_models: { offline: nope/model }\nstrategy: { name: heuristic, thresholds: { long_chars: 1, many_messages: 1, premium_score: 1 } }\n`);
  expect(() => loadConfig(p)).toThrow('unknown provider "nope"');
});

test("missing file names the path", () => {
  expect(() => loadConfig("/nonexistent/coderouter.yaml")).toThrow("config not found");
});

test("privacy target with unknown provider throws", () => {
  const p = write(`default_provider: openai\nproviders:\n  openai: { baseURL: https://x }\nvirtual_models: {}\nprivacy: { target: nope/m, paths: ["/auth/**"] }\nstrategy: { name: heuristic, thresholds: { long_chars: 1, many_messages: 1, premium_score: 1 } }\n`);
  expect(() => loadConfig(p)).toThrow('unknown provider "nope"');
});

test("classifier target with unknown provider throws", () => {
  const p = write(`default_provider: openai\nproviders:\n  openai: { baseURL: https://x }\nvirtual_models: {}\nstrategy: { name: llm-classifier, classifier: { target: nope/nano }, thresholds: { long_chars: 1, many_messages: 1, premium_score: 1 } }\n`);
  expect(() => loadConfig(p)).toThrow('unknown provider "nope"');
});

test("privacy paths compile to patterns", () => {
  const p = write(`default_provider: openai\nproviders:\n  openai: { baseURL: https://x }\n  ollama: { baseURL: http://l }\nvirtual_models: {}\nprivacy: { target: ollama/m, paths: ["/auth/**", "**/secrets/**"] }\nstrategy: { name: heuristic, thresholds: { long_chars: 1, many_messages: 1, premium_score: 1 } }\n`);
  const cfg = loadConfig(p);
  expect(cfg.privacy!.patterns).toHaveLength(2);
  expect(cfg.privacy!.patterns[0]!.test('"filePath":"/repo/auth/x.ts"')).toBe(true);
});
