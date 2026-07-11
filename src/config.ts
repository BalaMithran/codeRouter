import { readFileSync } from "node:fs";
import { parse } from "yaml";

export type Provider = { baseURL: string; apiKey?: string };
export type Thresholds = { long_chars: number; many_messages: number; premium_score: number };
export type Config = {
  default_provider: string;
  providers: Record<string, Provider>;
  virtual_models: Record<string, string>;
  strategy: { name: string; thresholds: Thresholds };
};

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
    const prov = target.split("/")[0];
    if (!cfg.providers[prov]) throw new Error(`virtual model "${vm}" targets unknown provider "${prov}"`);
  }
  return cfg;
}
