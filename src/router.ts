import type { Config } from "./config";
import { strategies } from "./strategy";

export type Route = { provider: string; model: string; privacy?: true };

function split(target: string): Route {
  const slash = target.indexOf("/");
  return { provider: target.slice(0, slash), model: target.slice(slash + 1) };
}

export async function resolve(requested: string, body: any, cfg: Config): Promise<Route> {
  // Privacy first: matched content must never reach the cloud — not even the classifier.
  if (cfg.privacy?.patterns.some((r) => r.test(JSON.stringify(body)))) {
    return { ...split(cfg.privacy.target), privacy: true };
  }
  let target = cfg.virtual_models[requested];
  if (target === "auto") {
    const strategy = strategies[cfg.strategy.name];
    if (!strategy) throw new Error(`unknown strategy: ${cfg.strategy.name}`);
    target = cfg.virtual_models[await strategy(body, cfg)];
  }
  if (target) return split(target);
  const slash = requested.indexOf("/");
  if (slash > 0 && cfg.providers[requested.slice(0, slash)]) {
    return split(requested);
  }
  return { provider: cfg.default_provider, model: requested };
}
