# Ship a blog-to-social AI agent with ADK-TS and Next.js

_Build "The Draft Desk" — a Next.js app that turns any blog post into LinkedIn, X, and
Threads drafts — using a single ADK-TS `LlmAgent`, the built-in `WebFetchTool`, a Zod output
schema, and two plugins that make the whole thing fast and resilient._

> **What you'll learn:** the ADK-TS single-agent pattern, structured output with Zod, the
> plugin lifecycle (`beforeToolCallback` / `afterToolCallback`), composing built-in plugins,
> and handling upstream LLM errors at the action boundary.
>
> **Stack:** [ADK-TS](https://adk.iqai.com/) · Next.js 15 (App Router + Server Actions) ·
> Tailwind v4 · TypeScript.
>
> **Time:** ~60–90 minutes if you type along.

![The Draft Desk — finished app screenshot placeholder](./screenshots/finished.png)

---

## 1. What you'll build

Paste a blog URL. Pick a voice (auto, professional, casual, educational, punchy). Toggle
the platforms you want (LinkedIn, X, Threads). For X and Threads, choose **single post** or
**thread** mode (with a 2–10 post length stepper). Click **Draft**.

An ADK-TS agent fetches the article, then writes one platform-tailored draft per selection —
respecting each platform's hard char limit per post. Every draft is editable inline, has its
own **Copy** and **Rewrite** button, and the last 10 articles you run live in a sidebar
archive (stored in `localStorage`).

The whole thing is driven by **one `LlmAgent`**. No orchestration, no sub-agents. The
interesting work is in the plugins.

---

## 2. The starter

Clone the repo and check out the `starter` branch:

```bash
git clone https://github.com/IQAIcom/adk-ts-samples.git
cd adk-ts-samples/apps/social-media-drafting-agent
git checkout starter
pnpm install
```

You're given:

- **The UI is done** — [`src/components/drafter.tsx`](src/components/drafter.tsx) handles
  the form, draft articles, and history. It's already wired to call `previewPosts` and
  `regenerateDraft` from `@/app/actions`.
- **Types are defined** — [`src/types.ts`](src/types.ts) has `Platform`, `Tone`,
  `PostFormat`, `PlatformDraft`, char limits, and thread bounds. You'll import these into
  the agent and actions.
- **Env is schema-validated** — [`env.ts`](env.ts) parses `GOOGLE_API_KEY` + `LLM_MODEL` at
  boot. Missing key → process refuses to start.
- **Dependencies are pre-installed** — `@iqai/adk`, `zod`, `lucide-react`, Tailwind v4.
- **Reference implementation** — [`_final_code/`](_final_code/) has the finished code.
  Peek when stuck.

What's **not** there:

- `src/agents/` doesn't exist yet. You'll create it.
- `src/app/actions.ts` has two stubs that throw:
  ```
  Error: Not implemented yet — build the agent at src/agents/draft-generator/agent.ts…
  ```

Set up your env and start the dev server:

```bash
cp .env.example .env
# edit .env and paste your Google AI Studio key
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The form renders. Clicking **Draft**
throws the stub error — exactly the cliffhanger we pick up next.

---

## 3. Setting up ADK-TS

ADK-TS (the **Agent Development Kit** for TypeScript) is already a dependency. The starter's
`package.json` has:

```json
{
  "dependencies": {
    "@iqai/adk": "0.8.5",
    "zod": "^4.1.12",
    ...
  }
}
```

The pieces we'll use from it in this article:

| Import                          | What it is                                                 |
| ------------------------------- | ---------------------------------------------------------- |
| `AgentBuilder`                  | Fluent builder that configures and builds an `LlmAgent`    |
| `WebFetchTool`                  | Built-in tool for reading a URL as clean article text      |
| `BasePlugin`                    | Base class for custom plugins with lifecycle callbacks     |
| `ReflectAndRetryToolPlugin`     | Built-in plugin that retries flaky tool calls              |

Let's verify your env is wired. In `env.ts` you already have:

```ts
import { config } from "dotenv";
import { z } from "zod";

config();

export const envSchema = z.object({
  ADK_DEBUG: z.coerce.boolean().default(false),
  GOOGLE_API_KEY: z.string().min(1, "GOOGLE_API_KEY is required"),
  LLM_MODEL: z.string().default("gemini-2.5-flash"),
});

export const env = envSchema.parse(process.env);
```

Default model is `gemini-2.5-flash` — fast, cheap, fine for this demo. You can override
`LLM_MODEL=gemini-2.5-pro` in `.env` if you want.

Create the agent folder:

```bash
mkdir -p src/agents/draft-generator
```

That's the scaffolding. Now the fun part.

---

## 4. The minimum viable agent

Our agent has exactly one job: given a URL, a tone, and a list of platforms, return
structured JSON with a draft per platform.

Create `src/agents/draft-generator/agent.ts`:

```ts
import { AgentBuilder, WebFetchTool } from "@iqai/adk";
import z from "zod";
import { env } from "../../../env";

/**
 * Schema the draft generator must return. One draft per target platform.
 * For X or Threads in thread mode, `segments` carries the chained posts.
 */
export const postDraftsSchema = z.object({
  article: z.object({
    url: z.string(),
    title: z.string(),
  }),
  drafts: z.array(
    z.object({
      platform: z.enum(["linkedin", "x", "threads"]),
      content: z.string(),
      segments: z.array(z.string()).optional(),
      hashtags: z.array(z.string()),
    }),
  ),
});

export type PostDraftsOutput = z.infer<typeof postDraftsSchema>;

export const getDraftGenerator = async () => {
  const { runner } = await AgentBuilder.create("draft_generator")
    .withDescription(
      "Fetches a blog post and generates platform-optimized social media drafts. Returns structured JSON.",
    )
    .withInstruction(
      `You are a social media content specialist. Given a blog post URL, a tone, and a list of target platforms with their hard character limits and formats:

1. Use the web_fetch tool to read the article. Record its title.
2. For EACH requested platform, generate exactly ONE draft tailored to that platform.

   Platform writing guidelines:
   - **x** (post): Single punchy post with hook, casual voice, 2-3 hashtags. Fit the 280-char limit.
   - **x** (thread): A chained thread of exactly the requested number of posts. Each post MUST be <=280 characters on its own. Post 1 is the hook. Middle posts develop the idea. Final post ends with a CTA phrase like "Full post ↓" or "Read more ↓". Return the full array in \`segments\` AND a plain \`content\` string with the segments joined by two newlines.
   - **threads** (post): Single conversational, community-friendly post. 1-3 hashtags. Fit the 500-char limit.
   - **threads** (thread): A chained thread of exactly the requested number of posts. Each post MUST be <=500 characters on its own. Return the full array in \`segments\` AND a joined \`content\` string.
   - **linkedin**: Polished, authoritative single post with a clear takeaway. 3-5 hashtags at the end. (LinkedIn is always a single post — ignore thread settings.)

3. URL HANDLING — IMPORTANT: Do NOT include the literal article URL in the draft content or segments. The app appends the URL on copy for single posts. CTA phrases like "Read more ↓" or "Full post here" are encouraged where they fit naturally.

4. Character limits in the prompt are HARD — never exceed them. For thread format, each segment must independently fit its platform's per-post limit. Trim if close.

5. When asked for a thread of N posts, return EXACTLY N segments — not fewer, not more.

6. Apply the requested tone:
   - **auto**: Pick a tone that fits each platform (punchy for X, conversational for Threads, professional for LinkedIn).
   - **professional / casual / educational / punchy**: Apply uniformly.

7. Return ONLY valid JSON matching the output schema. No markdown fences. The \`article\` block must include the URL and the fetched title. Each draft must include \`content\`; threads in thread format must ALSO include \`segments\`. Do NOT include \`segments\` for single-post formats or for LinkedIn.`,
    )
    .withModel(env.LLM_MODEL)
    .withTools(new WebFetchTool())
    .withOutputSchema(postDraftsSchema)
    .build();

  return runner;
};
```

**What's happening:**

- `AgentBuilder.create("draft_generator")` — start a builder. The string is the agent's
  name, used in logs.
- `.withDescription(...)` — a one-liner for the agent's purpose.
- `.withInstruction(...)` — the system prompt. Platform guidelines, char limits, URL
  handling rules. The char limits aren't guessed — they're baked into the prompt so the
  model has no room to hallucinate "oh, X is 500 chars now."
- `.withModel(env.LLM_MODEL)` — Gemini 2.5 Flash by default.
- `.withTools(new WebFetchTool())` — give the agent the built-in `web_fetch` tool. No HTML
  parsing code. ADK-TS does the fetching, cleaning, and returning text.
- `.withOutputSchema(postDraftsSchema)` — register the Zod schema. The agent's output is
  validated against it. If the model returns garbage, this throws; if it returns well-formed
  JSON, the action gets a **typed** object.
- `.build()` returns `{ runner }` — the runner is what you call `.ask(prompt)` on.

> **ADK-TS feature spotlight:** `withOutputSchema(zodSchema)` is the backbone of reliable
> agent output. Without it, you'd be parsing free-form text and guessing at shape. With it,
> your server action gets a `z.infer`-typed object and TypeScript catches mismatches at
> compile time.

The schema has two clever bits worth calling out:

- **`segments: z.array(z.string()).optional()`** — a draft can be a single post (`content`
  only) or a chained thread (`content` + `segments`). The optional field lets one schema
  cover both cases cleanly.
- **`platform: z.enum(["linkedin", "x", "threads"])`** — the model can't invent a platform.
  If it returns `"bluesky"`, validation fails immediately.

---

## 5. Wiring the agent to the UI

The UI calls `previewPosts` and `regenerateDraft` from `@/app/actions`. Time to fill in
those stubs.

Open `src/app/actions.ts` and replace the contents:

```ts
"use server";

import { getDraftGenerator } from "@/agents/draft-generator/agent";
import {
  type ArticlePreview,
  PLATFORM_SPECS,
  type Platform,
  type PlatformDraft,
  type PostFormat,
  type PreviewResult,
  THREAD_LENGTH_MAX,
  THREAD_LENGTH_MIN,
  type Tone,
} from "@/types";

// Singleton runner — avoid re-initializing on every call.
let draftRunner: Awaited<ReturnType<typeof getDraftGenerator>> | null = null;

async function ensureDraftRunner() {
  if (!draftRunner) draftRunner = await getDraftGenerator();
  return draftRunner;
}

// Only X and Threads can be threaded; LinkedIn is always a single post.
const isThreadable = (platform: Platform): boolean =>
  platform === "x" || platform === "threads";

const clampThreadLength = (n: number): number =>
  Math.min(THREAD_LENGTH_MAX, Math.max(THREAD_LENGTH_MIN, Math.round(n)));

function buildDraft(
  platform: Platform,
  content: string,
  hashtags: string[],
  segments: string[] | undefined,
  format: PostFormat,
): PlatformDraft {
  const spec = PLATFORM_SPECS[platform];
  const wantsThread = format === "thread" && isThreadable(platform);
  const hasSegments = Array.isArray(segments) && segments.length > 1;

  if (wantsThread && hasSegments && segments) {
    const joined = segments.join("\n\n");
    const maxLen = segments.reduce((m, s) => Math.max(m, s.length), 0);
    return {
      platform,
      content: joined,
      segments,
      hashtags,
      charLimit: spec.charLimit,
      charCount: maxLen,
    };
  }

  return {
    platform,
    content,
    hashtags,
    charLimit: spec.charLimit,
    charCount: content.length,
  };
}

function formatLabel(
  platform: Platform,
  format: PostFormat,
  threadLength: number,
): string {
  if (format === "thread" && isThreadable(platform)) {
    return `thread of ${threadLength} posts (each <=${PLATFORM_SPECS[platform].charLimit} chars)`;
  }
  return `single post (<=${PLATFORM_SPECS[platform].charLimit} chars)`;
}

function buildPlatformBrief(
  platforms: Platform[],
  format: PostFormat,
  threadLength: number,
): string {
  return platforms
    .map((p) => {
      const spec = PLATFORM_SPECS[p];
      return `- ${p} — ${spec.label} — format: ${formatLabel(p, format, threadLength)}`;
    })
    .join("\n");
}

type AgentOutput = {
  article: ArticlePreview;
  drafts: Array<{
    platform: Platform;
    content: string;
    segments?: string[];
    hashtags: string[];
  }>;
};

export async function previewPosts(params: {
  url: string;
  tone: Tone;
  platforms: Platform[];
  format: PostFormat;
  threadLength: number;
}): Promise<PreviewResult> {
  const { url, tone, platforms, format } = params;
  const threadLength = clampThreadLength(params.threadLength);
  if (platforms.length === 0) {
    throw new Error("Select at least one platform.");
  }

  const runner = await ensureDraftRunner();

  const prompt = `Generate one social media draft per requested platform for this article.

URL to fetch with web_fetch: ${url}

Tone: ${tone}

Requested platforms and formats:
${buildPlatformBrief(platforms, format, threadLength)}

Return exactly ${platforms.length} draft${platforms.length === 1 ? "" : "s"} — one per platform listed above. Do NOT exceed any platform's per-post char limit. For platforms in "thread" format, return a \`segments\` array with EXACTLY ${threadLength} posts.`;

  const result = (await runner.ask(prompt)) as AgentOutput;

  const selected = new Set(platforms);
  const drafts: PlatformDraft[] = result.drafts
    .filter((d) => selected.has(d.platform))
    .map((d) =>
      buildDraft(d.platform, d.content, d.hashtags, d.segments, format),
    );

  return { article: result.article, drafts };
}

export async function regenerateDraft(params: {
  url: string;
  platform: Platform;
  tone: Tone;
  format: PostFormat;
  threadLength: number;
}): Promise<PlatformDraft> {
  const { url, platform, tone, format } = params;
  const threadLength = clampThreadLength(params.threadLength);

  const runner = await ensureDraftRunner();
  const spec = PLATFORM_SPECS[platform];

  const wantsThread = format === "thread" && isThreadable(platform);

  const prompt = `Use web_fetch to read this article, then generate exactly one draft for "${platform}".

URL: ${url}

Tone: ${tone}

Platform and format:
- ${platform} — ${spec.label} — format: ${formatLabel(platform, format, threadLength)}

Return JSON with the article block AND exactly one draft for "${platform}". Try a fresh angle or hook so this feels different from a typical first attempt. Do NOT exceed the per-post char limit. ${
    wantsThread
      ? `Return a \`segments\` array with EXACTLY ${threadLength} posts.`
      : ""
  }`;

  const result = (await runner.ask(prompt)) as AgentOutput;

  const match = result.drafts.find((d) => d.platform === platform);
  if (!match) {
    throw new Error(`Agent did not return a draft for platform: ${platform}`);
  }

  return buildDraft(
    match.platform,
    match.content,
    match.hashtags,
    match.segments,
    format,
  );
}
```

**Two patterns worth calling out:**

1. **Singleton runner.** `ensureDraftRunner` lazily builds the runner the first time it's
   needed, then caches it in a module-level variable. Next.js Server Actions run per
   request, so without the singleton you'd rebuild the agent every single time — slow, and
   it breaks plugin state (we'll see why in a minute).

2. **Prompt injection, literally.** The char limits and thread length aren't in the system
   prompt — they're injected per request via `buildPlatformBrief`. The model is told
   exactly what to fit and what format to return.

Save, restart `pnpm dev`, and try it:

```
URL:       https://your-blog.com/post-slug
Voice:     Auto
For:       LinkedIn, X, Threads
As:        Post
```

Click **Draft**. After a few seconds you get three draft articles, each under their char
limit, each with tone and platform voice adapted. Click **Rewrite** on one — it regenerates
just that draft.

Ship it? Almost. There's a problem.

---

## 6. The regenerate problem → a custom plugin

Click **Rewrite** a few times. Notice the delay? Each rewrite takes the same ~4–8 seconds as
the first draft. That's because the agent runs `web_fetch` again every single time — we're
re-downloading and re-parsing the same article for every regenerate.

We could paper over this by threading the article text through every call. But that makes
the server action responsible for state management. The cleaner answer is a **plugin**:

> **ADK-TS feature spotlight: plugins.** Plugins are lifecycle hooks that sit around the
> agent's execution. For tool calls specifically, `beforeToolCallback` fires before the
> tool runs and can short-circuit it (return a value instead); `afterToolCallback` fires
> after the tool runs and can observe or transform the result.

We'll build a plugin that:

- Intercepts every `web_fetch` call (via `beforeToolCallback`)
- If the URL is in cache and not expired, return the cached result — the tool never runs
- Otherwise let the tool run normally, then store the result (via `afterToolCallback`)

Create `src/agents/draft-generator/web-fetch-cache-plugin.ts`:

```ts
import type { BaseTool, ToolContext } from "@iqai/adk";
import { BasePlugin } from "@iqai/adk";

/**
 * Caches results from the ADK-TS `WebFetchTool` by URL with a TTL.
 */
export class WebFetchCachePlugin extends BasePlugin {
  private cache = new Map<string, { result: unknown; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 60 * 60 * 1000) {
    super("web-fetch-cache");
    this.ttlMs = ttlMs;
  }

  private keyFor(args: Record<string, unknown>): string | null {
    const url = args.url;
    return typeof url === "string" ? url : null;
  }

  async beforeToolCallback(params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
  }): Promise<Record<string, unknown> | undefined> {
    if (params.tool.name !== "web_fetch") return undefined;

    const key = this.keyFor(params.toolArgs);
    if (!key) return undefined;

    const hit = this.cache.get(key);
    if (hit && Date.now() < hit.expiresAt) {
      // Short-circuit: the agent receives the cached result as if it just fetched.
      return hit.result as Record<string, unknown>;
    }

    return undefined; // allow the tool to run normally
  }

  async afterToolCallback(params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    result: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    if (params.tool.name !== "web_fetch") return undefined;

    const key = this.keyFor(params.toolArgs);
    if (!key) return undefined;

    // Only cache successful results
    if ((params.result as { success?: boolean }).success !== false) {
      this.cache.set(key, {
        result: params.result,
        expiresAt: Date.now() + this.ttlMs,
      });
    }

    return undefined; // don't modify the fresh result
  }
}
```

**Three things to notice:**

1. **The return value of `beforeToolCallback` is the contract.** Return `undefined` and the
   tool runs normally. Return a value and that value is fed to the agent **as if the tool
   had just returned it**. The agent never knows the cache existed.

2. **We filter by tool name.** `if (params.tool.name !== "web_fetch") return undefined;` —
   plugins are global. If you later add a second tool, this plugin won't touch it.

3. **Cache state lives on the plugin instance.** Since we instantiate the plugin once and
   attach it to the singleton runner, cache entries survive across server action calls for
   the lifetime of the process.

Now wire it into the agent. Open `src/agents/draft-generator/agent.ts` and update:

```diff
-import { AgentBuilder, WebFetchTool } from "@iqai/adk";
+import { AgentBuilder, WebFetchTool } from "@iqai/adk";
 import z from "zod";
 import { env } from "../../../env";
+import { WebFetchCachePlugin } from "./web-fetch-cache-plugin";
+
+const webFetchCachePlugin = new WebFetchCachePlugin(60 * 60 * 1000);
```

And in the builder chain:

```diff
     .withModel(env.LLM_MODEL)
     .withTools(new WebFetchTool())
+    .withPlugins(webFetchCachePlugin)
     .withOutputSchema(postDraftsSchema)
     .build();
```

Reload, generate drafts, click **Rewrite**. The first fetch takes a few seconds; every
rewrite after that returns almost instantly. The agent's text is still regenerated each
time (that's the _point_ of rewrite), but the article download — which dominated latency —
is gone.

Confirm in your server logs: only the first `web_fetch` shows a network trip.

---

## 7. Flaky networks → the retry plugin

Blogs go down. DNS flakes. Your lunch-time Wi-Fi drops a packet. Right now if `web_fetch`
fails, the whole generation explodes.

ADK-TS ships `ReflectAndRetryToolPlugin` for exactly this. Add it to the agent:

```diff
 import {
   AgentBuilder,
+  ReflectAndRetryToolPlugin,
   WebFetchTool,
 } from "@iqai/adk";
```

```diff
 const webFetchCachePlugin = new WebFetchCachePlugin(60 * 60 * 1000);
+
+const reflectRetryPlugin = new ReflectAndRetryToolPlugin({
+  name: "web_fetch_retry",
+  maxRetries: 2,
+  throwExceptionIfRetryExceeded: true,
+});
```

And in the builder chain:

```diff
-    .withPlugins(webFetchCachePlugin)
+    .withPlugins(webFetchCachePlugin, reflectRetryPlugin)
```

That's it. When `web_fetch` fails transiently, the plugin retries up to 2 times before
giving up. `throwExceptionIfRetryExceeded: true` ensures the failure surfaces as a real
error (so we can handle it in step 8) instead of silently returning empty output.

> **Feature spotlight: plugin composition.** You pass multiple plugins to
> `.withPlugins(...)` and they stack. Order matters — `webFetchCachePlugin` comes first, so
> cache hits short-circuit _before_ retry ever sees them. On a miss, both plugins' hooks
> run in the expected order.

---

## 8. When the model itself fails

Here's a real error from a production run of this app:

```
Failed to parse and validate LLM output against the schema.
Raw output: Error: {"error":{"code":503,"message":"This model is currently experiencing
high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}
```

Gemini returned an HTTP 503 (overloaded). The error string came back as the model's
response text, which then failed schema validation because it wasn't JSON. The UI surfaced
this as a 400-character zod dump.

Two fixes:

### 8a. Retry transient errors around `runner.ask`

`ReflectAndRetryToolPlugin` wraps **tool calls**, not the model's own call. If Gemini is
overloaded, we need to retry the whole `runner.ask()` invocation.

Add a retry helper at the top of `src/app/actions.ts` (after the imports):

```ts
type DraftRunner = Awaited<ReturnType<typeof getDraftGenerator>>;

const TRANSIENT_PATTERNS =
  /\b503\b|UNAVAILABLE|overload|high demand|RESOURCE_EXHAUSTED|\b429\b|ECONNRESET|ETIMEDOUT|fetch failed/i;

async function askWithRetry(
  runner: DraftRunner,
  prompt: string,
  maxRetries = 2,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await runner.ask(prompt);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!TRANSIENT_PATTERNS.test(msg) || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}
```

Exponential backoff: 500ms, 1s, 2s. Only retry transient errors — don't loop on bad input.

### 8b. Map noisy errors to short messages

Add a normalizer:

```ts
function toUserMessage(error: unknown): string {
  console.error("[actions]", error);
  const raw = error instanceof Error ? error.message : String(error);

  if (/\b503\b|UNAVAILABLE|overload|high demand/i.test(raw)) {
    return "The model is overloaded right now. Try again in a few seconds.";
  }
  if (/RESOURCE_EXHAUSTED|\b429\b|rate.?limit|quota/i.test(raw)) {
    return "Rate-limited by the AI provider. Wait a moment and retry.";
  }
  if (
    /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|fetch failed|getaddrinfo/i.test(raw)
  ) {
    return "Couldn't reach the article URL. Check the link and try again.";
  }
  if (/\b404\b/i.test(raw)) {
    return "Article not found at that URL.";
  }
  if (/paywall|login.?required/i.test(raw)) {
    return "This article is behind a login or paywall — can't read it.";
  }
  if (/ZodError|invalid_type|Invalid input|parse.*schema/i.test(raw)) {
    return "The model returned an unexpected response. Try again.";
  }
  return "Something went wrong generating drafts. Try again.";
}
```

The raw error still hits `console.error` for server-side debugging. Only the clean string
goes back to the client.

### 8c. Use them

In `previewPosts` and `regenerateDraft`, swap `runner.ask(prompt)` for
`askWithRetry(runner, prompt)` and wrap the body in `try/catch`:

```diff
-  const runner = await ensureDraftRunner();
-
-  const prompt = `...`;
-
-  const result = (await runner.ask(prompt)) as AgentOutput;
-  ...
-  return { article: result.article, drafts };
+  try {
+    const runner = await ensureDraftRunner();
+
+    const prompt = `...`;
+
+    const result = (await askWithRetry(runner, prompt)) as AgentOutput;
+    ...
+    return { article: result.article, drafts };
+  } catch (error) {
+    throw new Error(toUserMessage(error));
+  }
```

Do the same in `regenerateDraft`. The full version lives in [`_final_code/src/app/actions.ts`](_final_code/src/app/actions.ts).

Now hit it again while Gemini is hot. If a 503 comes through, the backoff usually clears it
before the user ever notices. If it doesn't, they see a one-line message instead of a
stack trace.

---

## 9. What you got

Run through the app one more time. You built:

- A **single `LlmAgent`** with a Zod schema that validates every response
- A **built-in tool** (`WebFetchTool`) that handles HTML parsing for you
- A **custom plugin** using `beforeToolCallback` and `afterToolCallback` to cache article
  fetches transparently
- A **built-in plugin** (`ReflectAndRetryToolPlugin`) stacked on top for transient fetch
  failures
- A **server-action boundary** that retries model-level errors and maps the noise to clean
  user messages

Total hand-written agent code: about 150 lines. No orchestrator, no sub-agents, no prompt
chain. One well-instructed agent with the right tools and plugins does the whole job.

---

## 10. Where to take it next

- **Add a platform.** Extend `Platform` in `src/types.ts`, add an entry to `PLATFORM_SPECS`,
  and update the agent's platform guidelines. The UI adapts automatically.
- **Swap the tool.** Replace `WebFetchTool` with `WebSearchTool` and take a topic instead of
  a URL — "write social posts about X."
- **Add a reviewer sub-agent.** A second agent that critiques drafts against a brand voice
  before the first agent returns. ADK-TS's `SequentialAgent` wires this up in a few lines.
- **Auto-publish.** Plug in a social-posting MCP server and add a **Publish** button that
  calls a publisher agent per platform.
- **Schedule.** Store drafts + a target time in a queue (BullMQ, Inngest) and publish on a
  cron — turn the desk into an editorial calendar.

The full finished implementation is in [`_final_code/`](_final_code/) on this branch.
Master has it at the top level.

---

## Resources

- [ADK-TS Documentation](https://adk.iqai.com/)
- [Built-in Tools Reference](https://adk.iqai.com/docs/framework/tools/built-in-tools)
- [Plugins Reference](https://adk.iqai.com/docs/framework/plugins)
- [ADK-TS Samples Repository](https://github.com/IQAIcom/adk-ts-samples)
- [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
- [Google AI Studio Keys](https://aistudio.google.com/app/api-keys)

Built something with this pattern? Share it in the
[ADK-TS community](https://t.me/+Z37x8uf6DLE3ZTQ8).
