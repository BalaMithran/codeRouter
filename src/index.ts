import { forward } from "./forward";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY not set (put it in .env)");
  process.exit(1);
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  // ponytail: 255s is Bun's max idle timeout; default 10s kills slow first tokens.
  // Streams idle longer than 255s need a keepalive story — known ceiling.
  idleTimeout: 255,
  routes: {
    "/health": new Response("ok"),
    "/v1/chat/completions": { POST: forward },
  },
});

console.log(`coderouter listening on ${server.url}`);
