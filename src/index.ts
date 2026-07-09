import { forward } from "./forward";

if (!process.env.CODEROUTER_API_KEY && !process.env.OPENROUTER_API_KEY) {
  console.error("no upstream API key: set CODEROUTER_API_KEY (or OPENROUTER_API_KEY) in .env");
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
