import { loadConfig } from "./config";
import { forward } from "./forward";
import { resolve } from "./router";

const cfg = loadConfig(process.env.CODEROUTER_CONFIG ?? "coderouter.yaml"); // throws with a clear message on bad config

// Best-effort: pull usage out of a completed response copy for the log line.
// Must never break the client stream — hence tee + catch-all.
async function logUsage(prefix: string, copy: Response) {
  try {
    const text = await copy.text();
    // depth-1 brace matching: usage objects nest details objects one level deep
    const usageLine = [...text.matchAll(/"usage":\s*(\{(?:[^{}]|\{[^{}]*\})*\})/g)].at(-1);
    const usage = usageLine ? JSON.parse(usageLine[1]) : undefined;
    console.log(`${prefix} tokens=${usage?.prompt_tokens ?? "?"}/${usage?.completion_tokens ?? "?"}`);
  } catch {
    console.log(`${prefix} tokens=?`);
  }
}

async function handle(req: Request): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { message: "invalid JSON body" } }, { status: 400 });
  }
  const requested = String(body.model ?? "");
  const route = resolve(requested, body, cfg);
  body.model = route.model;

  const res = await forward(JSON.stringify(body), cfg.providers[route.provider]);
  const prefix = `${requested} -> ${route.provider}/${route.model} ${res.status}`;
  if (res.body) {
    const [toClient, toLog] = res.body.tee();
    logUsage(prefix, new Response(toLog));
    return new Response(toClient, { status: res.status, headers: res.headers });
  }
  console.log(prefix);
  return res;
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  // ponytail: 255s is Bun's max idle timeout; default 10s kills slow first tokens.
  // Streams idle longer than 255s need a keepalive story — known ceiling.
  idleTimeout: 255,
  routes: {
    "/health": new Response("ok"),
    "/v1/chat/completions": { POST: handle },
  },
});

console.log(`coderouter listening on ${server.url} (providers: ${Object.keys(cfg.providers).join(", ")}; virtual: ${Object.keys(cfg.virtual_models).join(", ")})`);
