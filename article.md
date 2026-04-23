# Build an AI agent that turns blog posts into social drafts

Every new blog post means rewriting the same idea for social media — a punchy X post, a polished LinkedIn update, maybe an X thread. Each platform has its own voice and character limits, so drafts can't just be copy-pasted. It's repetitive work, and an ideal fit for an LLM.

In this tutorial we'll build an agent that does exactly that: reads a blog post and produces platform-tailored drafts in one pass. It becomes the backend of a small Next.js app where you paste a URL, pick a tone, and get a draft per platform.

We'll use ADK-TS — a TypeScript framework for building AI agents — and work through its built-in web-fetching tool, structured output with a Zod schema, and its plugin system, which we'll use to add both caching and retry logic.

You do not need any prior AI knowledge to follow along with the article. I have already prepared the UI for this project in the [starter branch](https://github.com/IQAIcom/adk-ts-samples/tree/starter/apps/social-media-drafting-agent) of the GitHub repo so we can focus on the agent. You can also find the final version of the project on the `main` branch for reference. Here's what we're building:

![The Draft Desk — final app screenshot](./screenshots/finished.png)

## What we're building

The app does three things: it takes a blog URL and some preferences, reads the article, and produces one draft per requested platform. For X and Threads we also support a **thread** mode that generates a chained 2–10 post thread instead of a single post while LinkedIn is always a single post.

The architecture for this demo is deliberately small:

- A **single agent** with one tool (read a URL) and a schema for its output.
- Two **plugins**: a custom one for caching article fetches, and a built-in one from ADK-TS for retrying flaky network calls.
- A thin **Next.js Server Action** layer that invokes the agent and returns results to the UI.

This base provides a clear pattern for building agents with tools and plugins, without the complexity of multiple sub-agents or an orchestrator. The agent is responsible for fetching the article and generating drafts; the server action handles prompt construction and response formatting; the plugins handle caching and retry logic.

## Grabbing the starter code

For you to follow along, clone the repo and switch to the starter branch:

```bash
git clone https://github.com/IQAIcom/social-media-drafting-agent.git
cd social-media-drafting-agent
git checkout starter
pnpm install
```

The starter branch includes:

- The complete **UI** in `src/components` and `src/app/page.tsx` — a form for pasting a URL, picking a tone, selecting platforms, and viewing generated drafts.
- The **domain types** in `src/types.ts` — TypeScript types for platforms, tones, article previews, and draft shapes.
- An **environment schema** in `env.ts` — a Zod schema for required environment variables, including the LLM model and the Google API key.
- A **Server Actions** file in `src/app/actions.ts` with stub functions for `previewPosts` and `regenerateDraft`.

Copy the env example, paste a key from [Google AI Studio](https://aistudio.google.com/app/api-keys), and start the dev server:

```bash
cp .env.example .env
# paste your GOOGLE_API_KEY into .env
pnpm dev
```

Tou should see the UI at `http://localhost:3000` with a form and a **Draft** button, but no drafts will be generated yet. Clcicking the button shows a stack trace error because the agent isn't implemented yet:

```text
Not implemented yet — build the agent at src/agents/draft-generator/agent.ts and wire it up here.
```

That is the starting point.

## Step 1: Build the agent

Before we write any code, let's review the core concepts.

An **agent** is an LLM paired with a set of tools it can call and a schema its output must conform to. When the agent runs, it receives a prompt, may call tools, and returns a response. If you're coming from the raw OpenAI SDK or ChatGPT, the new concepts are **tools** (functions the model can invoke) and **structured output** (declaring the expected shape of a response and letting the framework enforce it).

Our agent needs two capabilities: read a URL, and return structured JSON containing a title, the article URL, and an array of drafts. ADK-TS gives us both.

Create the folder:

```bash
mkdir -p src/agents/draft-generator
```

Then create `agent.ts` inside it:

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

Most of the file is prompt text. We define the actual agent in the `AgentBuilder` chain at the bottom. Walking through it:

`AgentBuilder.create("draft_generator")` begins a new agent definition. The string is the agent's name, used for logging.

`.withDescription(...)` is a short summary of what the agent does. It matters most in multi-agent setups where an orchestrator needs to pick between sub-agents.

`.withInstruction(...)` is the system prompt. This is the most consequential line in the file, and a few details in this one are worth highlighting:

- It lists per-platform character limits explicitly. Without concrete numbers, models tend to produce plausible-sounding output that silently misses the limit — a 320-char "tweet," for example. Naming the number keeps the model honest.
- It instructs the model not to include the article URL in draft text. The client appends the URL when the user copies a draft, so including it in both places produces duplicates.
- It states the output-shape rules in plain language alongside the schema. The schema alone usually suffices, but redundant instruction reduces retry rates noticeably.

`.withModel(env.LLM_MODEL)` selects the model. The default is `gemini-2.5-flash`, which is fast and inexpensive. Setting `LLM_MODEL=gemini-2.5-pro` in `.env` produces nicer prose at the cost of latency.

`.withTools(new WebFetchTool())` grants the agent access to ADK-TS's built-in `WebFetchTool`. It handles fetching a URL, stripping boilerplate (navigation, ads, cookie banners), and returning clean article text. Without it, the equivalent work means implementing or integrating a Readability-style parser.

`.withOutputSchema(postDraftsSchema)` registers the Zod schema. When a schema is registered, `runner.ask()` returns output that is already parsed and validated. If the model produces anything that does not conform, the call throws. This eliminates the typical `try { JSON.parse(response) } catch {...}` pattern.

Two details in the schema itself are worth noting:

```ts
drafts: z.array(
  z.object({
    platform: z.enum(["linkedin", "x", "threads"]),
    content: z.string(),
    segments: z.array(z.string()).optional(),
    hashtags: z.array(z.string()),
  }),
),
```

The `platform: z.enum([...])` constraint prevents the model from inventing platforms. If it returns `"bluesky"`, validation fails before the server action receives the result.

The optional `segments` field lets one schema cover both draft shapes. Single-post drafts have `content` only; chained threads have both `content` and `segments`. No union type, no discriminator — the optional field carries both cases.

That completes the agent definition. Saving the file makes no functional change yet because nothing is calling it. The next step wires it up.

## Step 2: Wire it to the UI

The UI imports `previewPosts` and `regenerateDraft` from the Server Actions file. If you're new to Next.js Server Actions: they're functions marked with a `"use server"` directive that Next.js makes callable from client components as if they were local async functions. The framework handles the RPC for you.

Open `src/app/actions.ts` and replace the stubs with:

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

// Singleton — build the runner once, reuse across requests.
let draftRunner: Awaited<ReturnType<typeof getDraftGenerator>> | null = null;

async function ensureDraftRunner() {
  if (!draftRunner) draftRunner = await getDraftGenerator();
  return draftRunner;
}

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

  return buildDraft(match.platform, match.content, match.hashtags, match.segments, format);
}
```

Two patterns in this file are worth explaining.

**The singleton runner.** `ensureDraftRunner` builds the agent the first time it is called, then caches it in a module-level variable. Every subsequent call returns the same runner.

Server Actions run per request, but module-level state in Next.js persists for the lifetime of the Node process. Rebuilding the runner on every call would be wasteful, and — more importantly — would prevent the stateful plugins added in later steps from retaining their state across requests. The cache relies on this.

**Prompt construction.** The per-platform character limits and the thread length are not in the system prompt. They are injected into the user prompt on every call via `buildPlatformBrief`. The general principle: the system prompt describes the agent's stable behavior; the user prompt carries request-specific variables. This keeps the agent reusable across requests with different constraints.

Save the file and restart the dev server — Next.js caches imports, so a restart is necessary.

Paste a blog URL, choose a tone, select some platforms, and click **Draft**. After 4–8 seconds, three drafts appear, each within its char limit and each in a distinct voice. Inline editing and per-draft regeneration work.

The app functions. Clicking **Rewrite** a few times reveals a problem.

## Step 3: A plugin for faster regeneration

Every rewrite takes the same 4–8 seconds as the first draft. The LLM's response changes each time, but the article is identical to the one fetched 30 seconds ago. The `web_fetch` call is repeated on every request, and that call accounts for most of the latency.

We could cache the article text in the server action and thread it through each call. That works, but the action accumulates responsibilities it shouldn't own.

A cleaner approach is to use ADK-TS's **plugin** system.

A plugin is a class that hooks into the agent's lifecycle. Several hooks exist; the two relevant here are `beforeToolCallback` and `afterToolCallback`, which fire before and after any tool call. `beforeToolCallback` can return a value, and when it does, the framework short-circuits the tool: the agent receives the returned value as if the tool had produced it. The tool itself is not invoked.

That is exactly what we need for a cache.

Create `src/agents/draft-generator/web-fetch-cache-plugin.ts`:

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
}
```

The contract is the important part: `beforeToolCallback` returns `undefined` to let the tool run as normal, or a value to bypass the tool entirely.

The `if (params.tool.name !== "web_fetch") return undefined;` check matters because plugins are global — they are invoked for every tool the agent calls. Filtering by name ensures this cache only interacts with `web_fetch` and ignores any additional tools added later.

The cache is a `Map` keyed by URL with per-entry expiration. A one-hour TTL is a reasonable default: short enough to catch same-day edits to a blog post, long enough to cover a user iterating on drafts for a single article.

Wire the plugin into the agent in `agent.ts`:

```diff
-import { AgentBuilder, WebFetchTool } from "@iqai/adk";
+import { AgentBuilder, WebFetchTool } from "@iqai/adk";
 import z from "zod";
 import { env } from "../../../env";
+import { WebFetchCachePlugin } from "./web-fetch-cache-plugin";
+
+const webFetchCachePlugin = new WebFetchCachePlugin(60 * 60 * 1000);
```

```diff
     .withModel(env.LLM_MODEL)
     .withTools(new WebFetchTool())
+    .withPlugins(webFetchCachePlugin)
     .withOutputSchema(postDraftsSchema)
     .build();
```

Note where the plugin is instantiated: it is a module-level `const`. Because the runner is a singleton, and the plugin is attached to that runner, the plugin's cache Map persists for the lifetime of the process. This is the reason the singleton pattern was established in Step 2.

Restart the dev server and test again. The first draft takes the usual time, but every subsequent rewrite returns in roughly a second — the LLM is still generating fresh text, but the article download is eliminated. Server logs show a single `web_fetch` call on the first generation and none after.

## Step 4: Handling flaky networks

Blog servers become unavailable. CDNs slow down. Network packets get dropped. In the current implementation, a single transient failure in `web_fetch` propagates through the entire generation and reaches the user as a stack trace.

ADK-TS ships `ReflectAndRetryToolPlugin` for this case. Add it to `agent.ts`:

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

```diff
-    .withPlugins(webFetchCachePlugin)
+    .withPlugins(webFetchCachePlugin, reflectRetryPlugin)
```

`ReflectAndRetryToolPlugin` retries a failed tool call up to `maxRetries` times. The "reflect" portion of the name refers to the fact that the plugin informs the model of the failure reason, allowing subsequent attempts to adapt — for example, to try a different URL formulation if the first was rejected.

`throwExceptionIfRetryExceeded: true` ensures that exhausting retries surfaces as a real error rather than an empty response. Without it, the agent would silently proceed with no article text and produce useless drafts.

Plugin order matters. The cache plugin is passed first, followed by retry. Plugins execute in order, so a cache hit short-circuits before the retry plugin is invoked. On a miss, both plugins participate in the usual sequence.

## Step 5: Handling model-level failures

The following error appeared during a real session shortly after deployment:

```text
Failed to parse and validate LLM output against the schema.
Raw output: Error: {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}
```

Gemini returned a 503 because its service was temporarily overloaded. The SDK surfaced the error as the model's text output, and schema validation then failed when trying to parse that error string as JSON. The user saw a 400-character validation stack trace.

We need two fixes. First, retry transient model errors — 503s typically clear in a few seconds. `ReflectAndRetryToolPlugin` doesn't help here because it wraps tool calls, not the model's own invocation, so we have to wrap `runner.ask()` ourselves. Second, map whatever survives retry into short, user-facing messages.

Add a retry helper in `actions.ts` after the imports:

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

The backoff schedule is 500ms, 1s, 2s. The regex matches only errors that are likely to resolve on retry. Looping on a schema violation or a missing API key would delay the inevitable failure without changing the outcome.

Add an error normalizer:

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

The raw error is still logged via `console.error`, so operations and debugging retain the full detail. The normalizer only controls what the end user sees.

Apply both helpers to `previewPosts` by replacing `runner.ask(prompt)` with `askWithRetry(runner, prompt)` and wrapping the body in `try/catch`:

```diff
-  const runner = await ensureDraftRunner();
-
-  const prompt = `...`;
-
-  const result = (await runner.ask(prompt)) as AgentOutput;
-  // ...
-  return { article: result.article, drafts };
+  try {
+    const runner = await ensureDraftRunner();
+
+    const prompt = `...`;
+
+    const result = (await askWithRetry(runner, prompt)) as AgentOutput;
+    // ...
+    return { article: result.article, drafts };
+  } catch (error) {
+    throw new Error(toUserMessage(error));
+  }
```

Apply the same change to `regenerateDraft`. The complete final version is available in [`_final_code/src/app/actions.ts`](_final_code/src/app/actions.ts) for reference.

With these changes in place, most transient model failures resolve silently through the retry. The remaining failures surface as a short, specific message.

## What we built

By this point, the app does the following:

- Generates a draft per selected platform, each within its character budget, each in a voice appropriate to the platform.
- Supports chained-thread generation for X and Threads at a configurable length (2–10 posts).
- Regenerates individual drafts without re-fetching the article, thanks to the cache plugin.
- Retries flaky article fetches automatically, thanks to the built-in retry plugin.
- Retries transient model failures at the server-action boundary, and presents clean messages to the user when retries fail.

The total agent code is around 200 lines. No orchestrator, no sub-agent coordination, no prompt chaining. A single well-instructed agent with one tool and the right plugins does the whole job.

## Extending the pattern

The architecture supports several natural extensions:

- **Add a platform.** Extend `Platform` in `src/types.ts`, add a `PLATFORM_SPECS` entry, and update the platform guidelines in the system prompt. The UI adapts automatically.
- **Change the input type.** Replacing `WebFetchTool` with `WebSearchTool` converts the input from a URL to a topic, enabling use cases like "draft social posts about the latest browser release."
- **Add a reviewer agent.** A second agent that critiques drafts against a brand voice before returning them can be composed with the first using ADK-TS's `SequentialAgent`.
- **Auto-publish.** Integrating a social-posting MCP server allows a **Publish** button to call a publisher agent; each platform's posting capability becomes an additional tool.
- **Schedule drafts.** A queue such as BullMQ or Inngest can hold drafts until a target publish time, turning the Draft Desk into a complete editorial workflow.

## Resources

- [ADK-TS documentation](https://adk.iqai.com/)
- [Built-in tools](https://adk.iqai.com/docs/framework/tools/built-in-tools)
- [Plugins reference](https://adk.iqai.com/docs/framework/plugins)
- [Google AI Studio](https://aistudio.google.com/app/api-keys)
- [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)

Developers building with this pattern are welcome to share their implementations in the [ADK-TS community](https://t.me/+Z37x8uf6DLE3ZTQ8).
