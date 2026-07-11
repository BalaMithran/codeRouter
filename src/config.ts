import { readFileSync } from "node:fs";
import { parse } from "yaml";

export type Provider = { baseURL: string; apiKey?: string };
export type Thresholds = { long_chars: number; many_messages: number; premium_score: number };
export type Classifier = { target: string; timeout_ms?: number };
export type Privacy = { target: string; paths: string[]; patterns: RegExp[] };
export type Config = {
  default_provider: string;
  providers: Record<string, Provider>;
  virtual_models: Record<string, string>;
  strategy: { name: string; thresholds: Thresholds; classifier?: Classifier };
  privacy?: Privacy;
};

export function globToRegex(glob: string): RegExp {
  // gitignore-style: leading "/" or "**/" compiles to a path-boundary assertion, so the
  // rule fires on relative paths too ("secrets/token.txt" in prose/tool args), not only
  // absolute ones. E2E showed OpenCode mostly sends relative paths - anchoring to a
  // literal "/" leaks the first requests of a session.
  const stripped = glob.replace(/^\/+/, "").replace(/^(\*\*\/)+/, "");
  const re = stripped
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // escape regex specials, keep *
    .replace(/\*\*/g, "\u0000")            // placeholder so the single-* pass doesn't eat it
    .replace(/\*/g, '[^/\\s"]*')           // * = one path segment (stops at / whitespace ")
    .replace(/\u0000/g, ".*");             // ** = anything
  return new RegExp(`(?:^|[/\\s"'=\\\\])${re}`, "i");              // over-matching routes local — the safe direction
}

function assertProvider(cfg: Config, target: string, what: string) {
  const prov = target.split("/")[0];
  if (!cfg.providers[prov]) throw new Error(`${what} targets unknown provider "${prov}"`);
}

export function loadConfig(path = "coderouter.yaml"): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`config not found: ${path}`);
  }
  text = text.replace(/\$\{(\w+)\}/g, (_, name) => {
    const v = process.env[name];
    if (v === undefined) throw new Error(`config references unset env var: ${name}`);
    return v;
  });
  const cfg = parse(text) as Config;
  if (!cfg.providers?.[cfg.default_provider]) {
    throw new Error(`default_provider "${cfg.default_provider}" not in providers`);
  }
  for (const [vm, target] of Object.entries(cfg.virtual_models ?? {})) {
    if (target === "auto") continue;
    assertProvider(cfg, target, `virtual model "${vm}"`);
  }
  if (cfg.strategy.classifier) assertProvider(cfg, cfg.strategy.classifier.target, "strategy.classifier");
  if (cfg.privacy) {
    assertProvider(cfg, cfg.privacy.target, "privacy");
    cfg.privacy.patterns = cfg.privacy.paths.map(globToRegex);
  }
  return cfg;
}
