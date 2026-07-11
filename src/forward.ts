import type { Provider } from "./config";

// ponytail: still one passthrough fn — routing picks the provider at the call site.
export async function forward(body: string, provider: Provider): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
        "content-type": "application/json",
        // no gzip: keeps the passthrough byte-exact
        "accept-encoding": "identity",
      },
      body,
    });
  } catch (e) {
    return Response.json(
      { error: { message: `upstream unreachable: ${provider.baseURL} (${e instanceof Error ? e.message : e})` } },
      { status: 502 },
    );
  }
  const headers = new Headers(upstream.headers);
  // Bun's fetch auto-decompresses; stale encoding/length headers would corrupt the client read
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, headers });
}
