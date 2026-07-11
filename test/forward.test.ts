import { afterAll, beforeAll, expect, test } from "bun:test";
import { forward } from "../src/forward";
import type { Provider } from "../src/config";

let mock: ReturnType<typeof Bun.serve>;
let provider: Provider;
let lastReq: { body: string; auth: string | null } | null = null;
let nextResponse: () => Response;

beforeAll(() => {
  mock = Bun.serve({
    port: 0,
    async fetch(req) {
      lastReq = { body: await req.text(), auth: req.headers.get("authorization") };
      return nextResponse();
    },
  });
  provider = { baseURL: `${mock.url.href.replace(/\/$/, "")}/v1`, apiKey: "test-key" };
});

afterAll(() => mock.stop(true));

test("non-streaming passthrough: body byte-identical, auth from provider, response intact", async () => {
  const upstreamBody = JSON.stringify({ id: "gen-1", choices: [{ message: { content: "hi" } }] });
  nextResponse = () => Response.json(JSON.parse(upstreamBody));
  const reqBody = JSON.stringify({ model: "gpt-4.1-mini", messages: [{ role: "user", content: "hi" }] });

  const res = await forward(reqBody, provider);

  expect(lastReq!.body).toBe(reqBody);
  expect(lastReq!.auth).toBe("Bearer test-key");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(JSON.parse(upstreamBody));
});

test("no apiKey -> no authorization header (ollama)", async () => {
  nextResponse = () => Response.json({ ok: true });
  await forward("{}", { baseURL: provider.baseURL });
  expect(lastReq!.auth).toBeNull();
});

test("SSE streaming passthrough: chunks + usage + [DONE] byte-identical", async () => {
  const sse =
    'data: {"choices":[{"delta":{"content":"he"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n' +
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n' +
    "data: [DONE]\n\n";
  nextResponse = () => new Response(sse, { headers: { "content-type": "text/event-stream" } });

  const res = await forward(JSON.stringify({ stream: true }), provider);

  expect(res.headers.get("content-type")).toBe("text/event-stream");
  expect(await res.text()).toBe(sse);
});

test("error passthrough: 429 + retry-after preserved", async () => {
  nextResponse = () =>
    new Response(JSON.stringify({ error: { message: "rate limit" } }), {
      status: 429,
      headers: { "retry-after": "7" },
    });

  const res = await forward("{}", provider);

  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("7");
});

test("unreachable upstream -> 502 JSON error, never 200", async () => {
  const res = await forward("{}", { baseURL: "http://localhost:1" });
  expect(res.status).toBe(502);
  const body = await res.json();
  expect(body.error.message).toContain("upstream unreachable");
});
