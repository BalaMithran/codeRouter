# CodeRouter

Intelligent provider layer behind [OpenCode](https://opencode.ai). OpenCode keeps the
terminal UX, agent loop, and tools; CodeRouter decides which model executes each task.

**Milestone 3 (current):** privacy engine + LLM-classifier routing. OpenCode asks for
`auto` / `cheap` / `premium` / `offline`; CodeRouter resolves the real provider+model
per request. Requests touching protected paths never leave the machine. Provider
contract in [docs/opencode-integration.md](docs/opencode-integration.md).

```
OpenCode  →  CodeRouter :8787  →  openai  (gpt-4.1 / gpt-4.1-mini)
                                  ollama  (llama3.1:8b, local)
```

## Quickstart (Docker)

```sh
git clone https://github.com/BalaMithran/codeRouter.git && cd codeRouter
cp .env.example .env            # edit CODEROUTER_OPENAI_KEY
docker compose up -d            # builds coderouter, starts ollama, pulls the model
curl localhost:8787/health      # -> ok
```

First run downloads the ollama image and pulls `llama3.1:8b` (~4.9GB) — `docker compose
logs -f ollama-pull` to watch progress. It's cached in a named volume, so later
`docker compose down && up` won't re-download it.

**Prerequisite:** the offline/privacy model needs real memory. Docker Desktop defaults
to ~50% of host RAM, which isn't enough for `llama3.1:8b` at the 32k context this
config uses (~9GB) — raise Docker Desktop's memory limit (Settings → Resources →
Memory) to 10GB+, or the offline/privacy routes will fail with an OOM error while
`cheap`/`premium`/`auto` (cloud) keep working fine.

To change routing/models without rebuilding the image, edit `coderouter.yaml` on the
host and `docker compose restart coderouter` — it's bind-mounted, not baked in.

## Wire up OpenCode

Add to `~/.config/opencode/opencode.jsonc`:

```jsonc
"provider": {
  "coderouter": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "CodeRouter",
    "options": { "baseURL": "http://localhost:8787/v1", "apiKey": "coderouter-local" },
    "models": {
      "auto":    { "name": "Auto",    "tool_call": true, "limit": { "context": 1047576, "output": 32768 }, "cost": { "input": 2, "output": 8 } },
      "cheap":   { "name": "Cheap",   "tool_call": true, "limit": { "context": 1047576, "output": 32768 }, "cost": { "input": 0.4, "output": 1.6 } },
      "premium": { "name": "Premium", "tool_call": true, "limit": { "context": 1047576, "output": 32768 }, "cost": { "input": 2, "output": 8 } },
      "offline": { "name": "Offline", "tool_call": true, "limit": { "context": 32768, "output": 8192 }, "cost": { "input": 0, "output": 0 } }
    }
  }
}
```

Model ids must be declared here — OpenCode never calls `/v1/models`. Set real
`limit`/`cost` values: zeros silently disable compaction and cost tracking.

## Local development

For hacking on the code, not the recommended way to just run it (use Docker above).

```sh
bun install
cp .env.example .env
bun start                       # reads coderouter.yaml, listens on :8787
bun test
```

Needs Ollama on the host: `OLLAMA_CONTEXT_LENGTH=32768 ollama serve` (default 4096 ctx
silently truncates OpenCode's prompts — this is why the flag matters) and `ollama pull
llama3.1:8b`. `CODEROUTER_OLLAMA_URL` in `.env` should stay `http://localhost:11434/v1`.

## Env vars

| var | required | purpose |
|---|---|---|
| `CODEROUTER_OPENAI_KEY` | yes | OpenAI API key, substituted into `coderouter.yaml` |
| `CODEROUTER_OLLAMA_URL` | yes | Ollama base URL; docker-compose sets this automatically, only matters bare-metal |
| `PORT` | no | gateway port, default 8787 |

## Virtual models

| id | routes to | picked by |
|----|-----------|-----------|
| `auto` | cheap or premium | gpt-4.1-nano classifies the request (~300ms, 3s timeout); any failure falls back to the keyword/size heuristic |
| `cheap` | openai/gpt-4.1-mini | static |
| `premium` | openai/gpt-4.1 | static |
| `offline` | ollama/llama3.1:8b | static |

Bare ids (`gpt-4.1`) pass through to `default_provider` unchanged; `provider/model`
ids route to that provider explicitly. All mappings + thresholds in
[coderouter.yaml](coderouter.yaml). Strategies are pluggable functions
(`src/strategy.ts`): `llm-classifier` (default) or `heuristic`.

## Privacy

`privacy.paths` globs in [coderouter.yaml](coderouter.yaml) (`/auth/**`,
`**/secrets/**`, …) are matched against the serialized request body — file paths in
tool args, bash commands, prose, and tool results all count. A match forces the
request to `privacy.target` (local Ollama), **overriding everything** including
explicit `premium`/`gpt-4.1` picks, and short-circuits before the classifier so
protected content is never sent to the cloud even for classification. Fail closed:
local model down → 502, never a cloud fallback. Once protected content enters a
session, every later request matches too (full history is re-sent) — taint is sticky.

Semantics: gitignore-style; leading `/` or `**/` matches at any path boundary, so
relative paths (`secrets/token.txt`) trigger rules too. Over-matching (a path-shaped
string in prose) routes local — the safe direction. **Known limit:** detection is
path-string based; secret *content* with no matching path won't trigger (content
scanning is a future milestone).

## Known limitations (accepted, logged)

- OpenCode's cost display uses static per-model metadata — for `auto` it shows premium
  pricing regardless of the routed model. The gateway log line
  (`auto -> openai/gpt-4.1-mini 200 tokens=1234/56`) is the truth.
- Virtual ids contain no model-family substring, so OpenCode applies its default system
  prompt family — fine for OpenAI + Ollama backends.
- Response `model` field shows the real upstream model, not the virtual id.
- Local model tool-calling: qwen2.5-coder:7b emitted tool calls as text (OpenCode
  requires native `tool_calls`) — hence llama3.1:8b.
- Offline/privacy routes need Docker Desktop memory raised past its default — see
  Quickstart prerequisite above.

## Verify

1. `curl localhost:8787/health` → ok
2. `curl` each virtual id, check routed model in the response `model` field + gateway log
3. `opencode run -m coderouter/auto "run ls and tell me what you see"` — tool executes,
   log shows the pick
4. Stop ollama → `offline` request returns 502 upstream-unreachable (OpenCode retries cleanly)

## Deferred (deliberately)

- Budget engine (daily spend cap) — M4
- Secret-content detection + redaction — future (privacy today is path-based)
- Bare-metal setup script — Docker now covers the hard parts (Ollama install, context
  length, model pull) it would have automated
- Hono, provider registry classes, dashboards — when a second implementation exists
