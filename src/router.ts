import type { Config } from "./config";
import { strategies } from "./strategy";

export type Route = { provider: string; model: string };

export function resolve(requested: string, body: any, cfg: Config): Route {
  let target = cfg.virtual_models[requested];
  if (target === "auto") {
    const strategy = strategies[cfg.strategy.name];
    if (!strategy) throw new Error(`unknown strategy: ${cfg.strategy.name}`);
    target = cfg.virtual_models[strategy(body, cfg.strategy.thresholds)];
  }
  if (target) {
    const slash = target.indexOf("/");
    return { provider: target.slice(0, slash), model: target.slice(slash + 1) };
  }
  const slash = requested.indexOf("/");
  if (slash > 0 && cfg.providers[requested.slice(0, slash)]) {
    return { provider: requested.slice(0, slash), model: requested.slice(slash + 1) };
  }
  return { provider: cfg.default_provider, model: requested };
}
