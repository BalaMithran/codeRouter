// ponytail: single passthrough fn — the future Provider interface implements this
// same signature when routing lands; registry/selection slots in at the call site.
const UPSTREAM = process.env.CODEROUTER_UPSTREAM ?? "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = process.env.CODEROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;

export async function forward(req: Request): Promise<Response> {
  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": req.headers.get("content-type") ?? "application/json",
      // no gzip: keeps the passthrough byte-exact
      "accept-encoding": "identity",
    },
    body: await req.arrayBuffer(),
  });
  const headers = new Headers(upstream.headers);
  // Bun's fetch auto-decompresses; stale encoding/length headers would corrupt the client read
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, headers });
}
