import { afterAll, beforeAll, expect, test } from "bun:test";

let mock: ReturnType<typeof Bun.serve>;
let forward: (req: Request) => Promise<Response>;
let lastReq: { body: string; auth: string | null } | null = null;
let nextResponse: () => Response;

beforeAll(async () => {
  mock = Bun.serve({
    port: 0,
    async fetch(req) {
      lastReq = { body: await req.text(), auth: req.headers.get("authorization") };
      return nextResponse();
    },
  });
  process.env.CODEROUTER_UPSTREAM = `${mock.url}v1/chat/completions`;
  process.env.OPENROUTER_API_KEY = "test-key";
  ({ forward } = await import("../src/forward"));
});

afterAll(() => mock.stop(true));

const request = (body: string) =>
  new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer coderouter-local" },
    body,
  });

test("non-streaming passthrough: body byte-identical, auth swapped, response intact", async () => {
  const upstreamBody = JSON.stringify({ id: "gen-1", choices: [{ message: { content: "hi" } }] });
  nextResponse = () => Response.json(JSON.parse(upstreamBody));
  const reqBody = JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "hi" }] });

  const res = await forward(request(reqBody));

  expect(lastReq!.body).toBe(reqBody);
  expect(lastReq!.auth).toBe("Bearer test-key");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(JSON.parse(upstreamBody));
});

test("SSE streaming passthrough: chunks + usage + [DONE] byte-identical", async () => {
  const sse =
    'data: {"choices":[{"delta":{"content":"he"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n' +
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n' +
    "data: [DONE]\n\n";
  nextResponse = () =>
    new Response(sse, { headers: { "content-type": "text/event-stream" } });

  const res = await forward(request(JSON.stringify({ stream: true })));

  expect(res.headers.get("content-type")).toBe("text/event-stream");
  expect(await res.text()).toBe(sse);
});

test("error passthrough: 429 + retry-after preserved", async () => {
  nextResponse = () =>
    new Response(JSON.stringify({ error: { message: "rate limit" } }), {
      status: 429,
      headers: { "retry-after": "7" },
    });

  const res = await forward(request("{}"));

  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("7");
});
