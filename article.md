# How to extend TypeScript AI agents with plugins and callbacks in ADK-TS

Getting an ADK-TS agent up and running is easy: a tool, a system prompt, a schema, and you are done. But shipping it to real users is the hard part. The same external call may fire five times in a row because someone kept clicking a button. An upstream API rate-limits you mid-request. A third-party service returns a 502 during a demo. None of this is really the agent's fault, but it all ends up being the agent's problem.

This is what **plugins** and **lifecycle callbacks** in ADK-TS are for. They let you layer caching, retries, metrics, and error handling around a TypeScript AI agent without touching the agent itself.

This article walks through three patterns you'll reach for on pretty much every ADK-TS agent:

1. Writing a custom plugin that hooks into the tool-call lifecycle.
2. Composing multiple plugins so they stack cleanly.
3. Handling model-level failures at the Server Action boundary, where plugins can't reach.

We'll work through all three in a small Next.js app called **The Draft Desk**, an AI-powered tool that turns a blog post into platform-tailored social drafts. The app itself is small, but what matters are the patterns. This article assumes you've already built a basic ADK-TS agent before — if you haven't, [How to Build Your First AI Agent in TypeScript with ADK-TS](https://blog.iqai.com/build-ai-agent-in-typescript-with-adk-ts/) is a good place to start. If you want a broader look at what the framework offers before diving in, [Introducing the Agent Development Kit for TypeScript](https://blog.iqai.com/introducing-the-agent-development-kit-adk-for-typescript/) has you covered.

## What we're building: The Draft Desk

The Draft Desk takes a blog URL, a tone, and a set of platforms, fetches the article, and writes one platform-tailored draft per selection. For X and Threads it also supports a **thread** mode — a chained 2–10 post thread — while LinkedIn is always a single post.

Under the hood, it's a small stack:

- A **single agent** with one built-in tool (`WebFetchTool`) and a Zod output schema.
- Two **plugins**: a custom cache plugin we'll write, plus a built-in retry plugin we'll stack on top.
- A thin **Next.js Server Action** layer that invokes the agent.

No orchestrator, no sub-agents, no prompt chain. Just one agent, doing one job. That way we can focus on the patterns without getting lost in complexity.

![The Draft Desk — final app screenshot](./screenshots/finished.png)

## Setting up the starter project

Clone the repo and switch to the starter branch:

```bash
git clone https://github.com/IQAIcom/adk-ts-samples.git
cd adk-ts-samples/apps/social-media-drafting-agent
git checkout starter
pnpm install
```

The starter branch has everything except the agent layer:

- The complete **UI** in `src/components` and `src/app/page.tsx`.
- TypeScript **domain types** in `src/types.ts`.
- An **environment schema** in `env.ts`.
- **Stub Server Actions** in `src/app/actions.ts` that currently throw "Not implemented yet."

Copy the env example, grab a key from [Google AI Studio](https://aistudio.google.com/app/api-keys), and boot the dev server:

```bash
cp .env.example .env
# paste your GOOGLE_API_KEY into .env
pnpm dev
```

At `http://localhost:3000` the UI loads, but clicking **Draft** throws an error. This is expected as the agent isn't built yet. We will implement the agent in the next section, then come back to the Server Actions and fill those in.

## Building the baseline agent

Before we can extend anything, we need an agent to extend. Create the agent file:

```bash
mkdir -p src/agents/draft-generator
```

Then create an `agent.ts` file inside it and start with the imports and the output schema:

```ts
import { AgentBuilder, WebFetchTool } from "@iqai/adk";
import z from "zod";
import { env } from "../../../env";

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
```

Two small details in the schema are worth calling out:

- `platform: z.enum(["linkedin", "x", "threads"])` locks the agent to our three platforms. If the model tries to return `"bluesky"`, schema validation fails before the result reaches any of our code.
- `segments: z.array(z.string()).optional()` lets one schema cover both shapes — a single post (just `content`) and a chained thread (`content` plus `segments`) — without needing a union type.

Below the schema, add the agent itself:

```ts
export const getDraftGenerator = async () => {
  const { runner } = await AgentBuilder.create("draft_generator")
    .withDescription(
      "Fetches a blog post and generates platform-optimized social media drafts. Returns structured JSON.",
    )
    .withInstruction(
      `You are a social media content specialist. Use the web_fetch tool to read the article, then generate one draft per requested platform, respecting hard per-platform char limits. Return ONLY valid JSON matching the output schema.`,
    )
    .withModel(env.LLM_MODEL)
    .withTools(new WebFetchTool())
    .withOutputSchema(postDraftsSchema)
    .build();

  return runner;
};
```

Three things are doing the work in the builder chain:

- `withTools(new WebFetchTool())` gives the agent a built-in web fetcher tool from ADK-TS. No HTML parsing on your end.
- `withOutputSchema(postDraftsSchema)` validates every response against the Zod schema. Anything non-conforming throws before it reaches your code.
- `withInstruction(...)` is the system prompt. The real version in the main branch spells out per-platform char limits, URL-handling rules, and thread-vs-post behavior — concrete numbers beat vague guidance every time.

Now wire the agent to the Server Actions. Open `src/app/actions.ts` and replace the current stubs. Start with the `"use server"` directive and the imports:

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
```

The `"use server"` directive at the top marks this file as Server Actions — every exported function becomes something the UI can call like a regular async function, with Next.js handling the RPC in between.

Next, a singleton for the agent runner:

```ts
// Singleton — build the runner once, reuse across requests.
let draftRunner: Awaited<ReturnType<typeof getDraftGenerator>> | null = null;

async function ensureDraftRunner() {
  if (!draftRunner) draftRunner = await getDraftGenerator();
  return draftRunner;
}
```

Server Actions run per request, but module state hangs around for the lifetime of the Node process. We build the runner once, cache it in `draftRunner`, and hand it back on every subsequent call. This matters more than it looks — the plugins we're about to add are stateful, and their state lives on the runner instance.

A couple of small helpers for request validation:

```ts
const isThreadable = (platform: Platform): boolean =>
  platform === "x" || platform === "threads";

const clampThreadLength = (n: number): number =>
  Math.min(THREAD_LENGTH_MAX, Math.max(THREAD_LENGTH_MIN, Math.round(n)));
```

`isThreadable` flags which platforms can be threaded (LinkedIn can't). `clampThreadLength` is input validation on the number of posts the client is asking for — if the UI sends `threadLength: 100` or `0`, this forces it back into the allowed 2–10 range before we pass it to the agent.

Next, a function that reshapes the agent's raw output into the `PlatformDraft` shape the UI expects:

```ts
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
    return {
      platform,
      content: joined,
      segments,
      hashtags,
      charLimit: spec.charLimit,
      charCount: 0, // threads track counts per segment in the UI
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
```

For threads, we join segments into `content`, keep the segments array for the UI, and leave `charCount` at 0 — each segment has its own per-post limit.

Two helpers that build the per-request section of the prompt we'll send to the agent:

```ts
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
```

`buildPlatformBrief` calls `formatLabel` once per selected platform and joins the results into a block of text. For a request with LinkedIn and X-as-a-thread-of-4, the output looks like:

```text
- linkedin — LinkedIn — format: single post (<=3000 chars)
- x — X (Twitter) — format: thread of 4 posts (each <=280 chars)
```

That block gets interpolated into the user prompt in `previewPosts` before we call the agent. The system prompt (inside `agent.ts`) stays constant; the parts that change per request — like this brief — go into the user prompt.

One type declaration that mirrors what the agent returns:

```ts
type AgentOutput = {
  article: ArticlePreview;
  drafts: Array<{
    platform: Platform;
    content: string;
    segments?: string[];
    hashtags: string[];
  }>;
};
```

Now the main Server Action — `previewPosts`, which takes the form inputs and returns one draft per selected platform:

```ts
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
```

The flow is: `ensureDraftRunner()` gets the singleton, we build a prompt with the runtime variables injected through `buildPlatformBrief`, `runner.ask(prompt)` calls the agent, then we reshape each draft with `buildDraft` before returning. The `.filter` is defensive — if the model returns a draft for a platform the user didn't select, we drop it rather than showing something unexpected.

And `regenerateDraft`, which does the same thing but for a single platform (called by the per-card **Rewrite** button):

```ts
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

  return buildDraft(match.platform, match.content, match.hashtags, match.segments, format);
}
```

Same shape as `previewPosts` — get runner, build prompt, call agent, reshape — but scoped to one platform and with a "try a fresh angle" nudge so a regenerate actually looks different from the first attempt.

One pattern worth naming before we move on: **prompt composition**. The system prompt (in `agent.ts`) describes the agent's stable behavior. The user prompt in these actions carries the parts that change per call — char limits, thread length, platform selection. That way one agent handles many kinds of requests without being rebuilt for each one.

Save the file, restart the dev server, and head to `http://localhost:3000`. Paste a blog URL, pick a tone and some platforms, and click **Draft**. After 4–8 seconds the drafts show up. The agent works.

Before moving on, run a quick test. Click **Rewrite** on one of the drafts, wait for it, click it again, and again. Every click takes roughly the same 4–8 seconds as the first generation. That's our baseline — keep the number in mind. In the next section we'll add a plugin that makes repeated rewrites feel near-instant, and we'll compare against this.

## Pattern 1: Write a custom TypeScript plugin with tool lifecycle callbacks

Now, let's talk about the problem. The `web_fetch` tool is called on every generation, including regenerations. Every `web_fetch` call re-downloads the article. Realistically, nothing about the source has changed between the clicks, so we're paying the network cost over and over for no reason.

A tempting fix is to cache the article text inside the Server Action and pass it through to the agent manually. That works, but it gives the action a second job — it's no longer just a request handler, it's also a cache manager. And the next time you want to add retries, or logging, or metrics, those end up in the action too.

ADK-TS gives you a cleaner way: a **plugin** with **lifecycle callbacks**.

A plugin is a class that hooks into specific points in the agent's execution. For tool calls, two callbacks are the ones to know:

- **`beforeToolCallback`** fires before a tool is invoked. If it returns a value, the framework short-circuits the tool — the agent receives that value as if the tool had produced it, and the actual tool never runs.
- **`afterToolCallback`** fires after a tool returns successfully. It can observe or transform the result before the agent sees it.

Put them together and you can intercept any tool call and decide what happens next. A short list of what this unlocks in real projects:

- **Caching**, like we're about to do here, but also for expensive lookups like geocoding, user profile fetches, or anything with a predictable key.
- **Rate limiting** — back off automatically when you're hammering a third-party API.
- **Auth injection** — add a fresh OAuth token to every tool call that needs one, without the tool or the agent knowing.
- **Redaction** — strip API keys, PII, or secrets from results before they hit logs or return to the client.
- **Metrics** — count tool calls per user, per tenant, per session, for billing or observability.
- **Mocking in tests** — short-circuit real Stripe, Slack, or database calls during integration tests.

Same pattern every time. Here's the cache version for our agent. Create `src/agents/draft-generator/web-fetch-cache-plugin.ts` and start with the class shell:

```ts
import type { BaseTool, ToolContext } from "@iqai/adk";
import { BasePlugin } from "@iqai/adk";

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

  // callbacks go here
}
```

The class extends `BasePlugin`, which is the ADK-TS base class every plugin inherits from. Inside it:

- `cache` — a `Map` keyed by URL, storing a result and an expiry timestamp.
- `ttlMs` — how long cache entries stay valid. Default is one hour.
- `keyFor(args)` — pulls the URL out of the tool's arguments. Tools that don't take a URL (a future tool you might add) return `null` here and get ignored.

Now the two callbacks. First, `beforeToolCallback`:

```ts
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
    return hit.result as Record<string, unknown>;
  }

  return undefined;
}
```

This runs before any tool call. First it filters to `web_fetch` — plugins see every tool call, and this callback only cares about fetches. Then it looks up the URL in the cache. On a fresh hit, it returns the cached result, and the framework short-circuits the tool: the agent gets the result as if `web_fetch` had just run. On a miss (or no cache entry), it returns `undefined`, which tells the framework to run the tool normally.

Then `afterToolCallback`, which stores successful results:

```ts
async afterToolCallback(params: {
  tool: BaseTool;
  toolArgs: Record<string, unknown>;
  toolContext: ToolContext;
  result: Record<string, unknown>;
}): Promise<Record<string, unknown> | undefined> {
  if (params.tool.name !== "web_fetch") return undefined;

  const key = this.keyFor(params.toolArgs);
  if (!key) return undefined;

  if ((params.result as { success?: boolean }).success !== false) {
    this.cache.set(key, {
      result: params.result,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  return undefined;
}
```

This runs after a tool call returns successfully. Same filter for the `web_fetch` tool. If the result isn't an explicit failure, we store it in the cache with a fresh expiry. Returning `undefined` passes the result through unchanged — we're only observing, not transforming.

Both methods go inside the `WebFetchCachePlugin` class from the first snippet.

Three things here generalize to any TypeScript agent plugin you write:

**The callback contract.** Returning `undefined` from `beforeToolCallback` means "let the tool run normally." Returning a value means "skip the tool, give the agent this instead." That single control point is what makes short-circuiting work.

**Filter by tool name.** The `if (params.tool.name !== "web_fetch") return undefined;` guard matters because plugins are global — every tool call the agent makes fires every plugin's callbacks. Without the filter, a cache keyed by URL would try to intercept tools that don't even take a URL.

**Plugin state lives on the instance.** The cache is a `Map` on the plugin class. Because the plugin is attached to a singleton runner — which is why we made it a singleton earlier — that cache survives across Server Action calls for the lifetime of the Node process.

> If you want to see `beforeToolCallback` and `afterToolCallback` used for a different purpose — enforcing hard rate limits on a tool rather than caching — we cover that approach in [Build a Research Assistant AI Agent with TypeScript and ADK-TS (Part 2)](https://blog.iqai.com/research-assistant-ai-agent-typescript-adk-ts-part-2/).

Now wire the plugin into the agent. Open `agent.ts` and add the import at the top, along with a module-level instance of the plugin:

```ts
import { WebFetchCachePlugin } from "./web-fetch-cache-plugin";

const webFetchCachePlugin = new WebFetchCachePlugin(60 * 60 * 1000);
```

Then attach it to the builder chain with `.withPlugins(...)`:

```ts
export const getDraftGenerator = async () => {
  const { runner } = await AgentBuilder.create("draft_generator")
    .withDescription(/* ... */)
    .withInstruction(/* ... */)
    .withModel(env.LLM_MODEL)
    .withTools(new WebFetchTool())
    .withPlugins(webFetchCachePlugin)
    .withOutputSchema(postDraftsSchema)
    .build();

  return runner;
};
```

Now, restart the dev server. The first draft still takes 4–8 seconds, but every **Rewrite** after that comes back in about a second. The LLM is still writing fresh text — that's the point of rewrite — but the fetch is gone for the rest of the session. And the server logs confirm it: one `web_fetch` call on the first generation, none after.

> **Key takeaway.** `beforeToolCallback` + `afterToolCallback` let you intercept, substitute, or observe tool calls without touching the agent or the tool. Caching is one use; auth injection, rate limiting, metrics, redaction, and test mocking are all variations on the same pattern.

## Pattern 2: Compose plugins for layered agent behavior

The internet is flaky. Third-party APIs return 502s, connections drop mid-request, upstream services rate-limit you without warning. Right now, a single transient tool failure propagates all the way to the user as a stack trace.

Rather than writing your own retry logic, stack a second plugin on top of the cache. ADK-TS ships `ReflectAndRetryToolPlugin` for exactly this. Add it to the import in `agent.ts`:

```ts
import {
  AgentBuilder,
  WebFetchTool,
  ReflectAndRetryToolPlugin,
} from "@iqai/adk";
```

Create an instance of it right next to the cache plugin:

```ts
const webFetchCachePlugin = new WebFetchCachePlugin(60 * 60 * 1000);

const reflectRetryPlugin = new ReflectAndRetryToolPlugin({
  name: "web_fetch_retry",
  maxRetries: 2,
  throwExceptionIfRetryExceeded: true,
});
```

Then pass both plugins to `.withPlugins(...)` in the builder chain:

```ts
.withPlugins(webFetchCachePlugin, reflectRetryPlugin)
```

`ReflectAndRetryToolPlugin` retries a failed tool call up to `maxRetries` times. The "reflect" part means it tells the model what went wrong between attempts, so the model can adjust — try a different URL shape, drop a broken header — instead of repeating the same failing call.

`throwExceptionIfRetryExceeded: true` matters. Without it, exhausted retries silently return an empty result. Empty would pass schema validation with garbage inside and look like a successful generation. With it set to true, the failure surfaces as a real error and the next layer (coming up in Pattern 3) can deal with it.

**Plugin order matters.** `.withPlugins(webFetchCachePlugin, reflectRetryPlugin)` runs the cache first, retry second. Cache hits short-circuit before retry ever sees the call. On a miss, both plugins participate in the usual order. Flip the order and retry would run before the cache could check — still correct, but wasted cycles on every cache hit.

This is the payoff of composing plugins: each one does a single thing, you stack them in whatever order makes sense, and you never end up with a tangled helper function that tries to handle caching, retries, logging, and metrics all at once.

> **Key takeaway.** Plugins compose. The order you pass them to `.withPlugins(...)` is the order they run. Build layered behavior out of small, single-purpose plugins — cache, retry, metrics, logging — instead of mixing concerns in one place.

## Pattern 3: Handle model failures at the Server Action boundary

Let's look at this error from a real session:

```text
Failed to parse and validate LLM output against the schema.
Raw output: Error: {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}
```

This error came from a 503 response by the model's API. The retry plugin only helps with tool calls, so it didn't catch this. The failure bubbled up to the Server Action, which threw it as an error, and Next.js turned it into a stack trace for the user. Not great.

**`ReflectAndRetryToolPlugin`** didn't help here. It's designed to retry tool calls, not the model call itself. When the model's API returns a 503, the plugin has no opportunity to step in because the failure happens outside the scope of any tool call.

When a failure isn't something plugins can see, you handle it one layer up — at the Server Action boundary.

Add a retry helper near the top of `src/app/actions.ts`:

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

This helper retries the entire `runner.ask(prompt)` call, which includes the model response. It looks for transient patterns in the error message — 503s, rate limits, timeouts, connection resets — and retries up to `maxRetries` times with exponential backoff. If it exhausts retries or sees an error that doesn't match the transient patterns, it throws the error so the next layer can handle it.

Let's also add a helper that turns raw errors into user-friendly messages:

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

This function looks for known patterns in the raw error message and returns a clean, user-friendly message. It also logs the full error for debugging. You can customize the patterns and messages based on the kinds of errors you see in practice.

Apply both helpers to `previewPosts`: swap `runner.ask(prompt)` for `askWithRetry(runner, prompt)` and wrap the body in `try/catch`. The shape looks like this:

```ts
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

  try {
    const runner = await ensureDraftRunner();
    const prompt = `...`; // same prompt as before

    const result = (await askWithRetry(runner, prompt)) as AgentOutput;

    const selected = new Set(platforms);
    const drafts: PlatformDraft[] = result.drafts
      .filter((d) => selected.has(d.platform))
      .map((d) =>
        buildDraft(d.platform, d.content, d.hashtags, d.segments, format),
      );

    return { article: result.article, drafts };
  } catch (error) {
    throw new Error(toUserMessage(error));
  }
}
```

Do the same for `regenerateDraft` — wrap its body in `try/catch` and swap `runner.ask` for `askWithRetry`. You can fine-tune the error handling per action if you want — maybe `regenerateDraft` has a different set of transient patterns, or you want a different user message. The key is that this layer is where you catch anything that falls through the plugins.

> **Key takeaway.** Plugins handle tool-level failures. Model-level failures (overload, rate limits, schema violations) and the user-facing messaging that goes with them belong at the Server Action boundary. Knowing which layer owns which kind of failure saves you from wondering why a retry plugin isn't catching a 503.

## Summary: three patterns for any production TypeScript agent

If you take anything from this article, it's these three:

- **Lifecycle callbacks** (`beforeToolCallback` / `afterToolCallback`) let you intercept, substitute, or observe tool calls without touching the agent or the tool.
- **Plugin composition** — multiple plugins stack in the order you pass them to `.withPlugins(...)`. Build layered behavior out of small, single-purpose pieces.
- **Action-boundary error handling** catches failures plugins can't see: model overload, rate limits, schema violations. Normalize there and logs stay rich while users see clean messages.

The Draft Desk is one example. These same patterns show up almost anywhere:

- A customer-support agent that caches order lookups so the same question doesn't hit your database every time.
- A code-review agent that logs every tool call (file read, test run, diff) for audit or billing.
- An ops agent whose Slack and PagerDuty tool calls get mocked out in CI.
- A data-pipeline agent that retries transient database timeouts or webhook 5xxs automatically.
- Any agent where you want observability, resilience, or feature-flagged behavior without rewriting the agent itself.

## Where to take it next

Here are a few ideas for how to extend The Draft Desk further, using the same patterns:

- **Add a platform.** Extend `Platform` in `src/types.ts`, add a `PLATFORM_SPECS` entry, and update the platform rules in the system prompt. The UI adapts automatically.
- **Change the input.** Swap `WebFetchTool` for `WebSearchTool` and the input becomes a topic instead of a URL — "draft social posts about the latest browser release."
- **Add a reviewer.** Chain a second agent that critiques drafts against a brand voice before returning, using ADK-TS's `SequentialAgent`.
- **Auto-publish.** Plug in a social-posting MCP server and add a **Publish** button. Each platform's posting capability becomes another tool.
- **Schedule it.** Queue drafts for a target publish time with BullMQ or Inngest — The Draft Desk becomes an editorial workflow.

## Resources

- [ADK-TS documentation](https://adk.iqai.com/)
- [Plugins reference](https://adk.iqai.com/docs/framework/plugins)
- [Built-in tools](https://adk.iqai.com/docs/framework/tools/built-in-tools)
- [How to Build Your First AI Agent in TypeScript with ADK-TS](https://blog.iqai.com/build-ai-agent-in-typescript-with-adk-ts/)
- [Build a Research Assistant AI Agent with TypeScript and ADK-TS (Part 1)](https://blog.iqai.com/build-research-assistant-agent-typescript-adk-ts-part-1/)
- [Build a Research Assistant AI Agent with TypeScript and ADK-TS (Part 2)](https://blog.iqai.com/research-assistant-ai-agent-typescript-adk-ts-part-2/)
- [Google AI Studio](https://aistudio.google.com/app/api-keys)
- [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)

Built something with this pattern? Share it in the [ADK-TS community](https://t.me/+Z37x8uf6DLE3ZTQ8).
