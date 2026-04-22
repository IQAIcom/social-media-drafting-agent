<div align="center">
  <img src="https://files.catbox.moe/vumztw.png" alt="ADK-TS Logo" width="80" />
  <br/>
  <h1>The Draft Desk — Starter</h1>
  <b>Starter code for the blog post on building a blog-to-social AI agent with <code>ADK-TS</code> and <code>Next.js</code>.</b>
  <br/>
  <i>Starter Template • UI Complete • Agent TODO</i>
</div>

---

This is the starting point for the article
**"Ship a blog-to-social AI agent with ADK-TS and Next.js"** _(link coming soon)_.

The UI is done. Your job is to build the agent that powers it.

## What's already here

- ✅ A complete Next.js UI — form for URL + tone + platforms + post/thread format, editable
  draft articles, local history sidebar (`src/components/drafter.tsx`, `hero.tsx`, `navbar.tsx`)
- ✅ Typed draft model in `src/types.ts` — `Platform`, `Tone`, `PostFormat`, `PlatformDraft`,
  `PreviewResult`, plus platform char limits and thread-length constants
- ✅ Env schema in `env.ts` — `GOOGLE_API_KEY` + `LLM_MODEL`, zod-validated at boot
- ✅ Editorial theme wired into `src/app/globals.css` — Tailwind v4 with paper/ink tokens
- ✅ All dependencies pre-installed — ADK-TS, zod, lucide-react, Tailwind v4

## What you'll build

Following the blog post, you'll fill in:

1. **A single `LlmAgent`** at `src/agents/draft-generator/agent.ts` — equipped with the
   built-in `WebFetchTool` and a Zod output schema
2. **Server actions** in `src/app/actions.ts` — `previewPosts` and `regenerateDraft` (currently
   stubs that throw "not implemented")
3. **A custom plugin** (`WebFetchCachePlugin`) using `before/afterToolCallback` to cache
   `web_fetch` results by URL — so "Rewrite" doesn't re-download the article
4. **ADK-TS's `ReflectAndRetryToolPlugin`** — auto-retries flaky blog fetches
5. **Error handling** in the server actions — retry transient model errors and surface
   user-friendly messages

The finished implementation lives in [`_final_code/`](./_final_code/) for reference — peek when
stuck.

## Getting Started

### Prerequisites

- **Node.js 22+** — [Download Node.js](https://nodejs.org/en/download/)
- **Google AI Studio API key** — [Get a key](https://aistudio.google.com/app/api-keys)
- **pnpm** — [Install pnpm](https://pnpm.io/installation)

### Installation

1. Clone this repository

```bash
git clone https://github.com/IQAIcom/adk-ts-samples.git
cd adk-ts-samples/apps/social-media-drafting-agent
git checkout starter
```

2. Install dependencies

```bash
pnpm install
```

3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` and add your API key:

```env
GOOGLE_API_KEY=your_google_api_key_here
LLM_MODEL=gemini-2.5-flash
```

### Running the App

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

At this point the UI renders and the form works, but clicking **Draft** will throw
"Not implemented yet" — that's your cue to start building. Open the blog post and follow along.

## Project Structure

```text
src/
├── agents/                           # ← you'll create this
│   └── draft-generator/
│       ├── agent.ts                  # ← LlmAgent + WebFetchTool + plugins + Zod schema
│       └── web-fetch-cache-plugin.ts # ← custom cache plugin
├── app/
│   ├── actions.ts                    # ← stubs to fill in
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── drafter.tsx                   # done
│   ├── hero.tsx                      # done
│   └── navbar.tsx                    # done
├── types.ts                          # done
└── env.ts                            # done
```

## Useful Resources

- [ADK-TS Documentation](https://adk.iqai.com/)
- [Built-in Tools Reference](https://adk.iqai.com/docs/framework/tools/built-in-tools)
- [Plugins Reference](https://adk.iqai.com/docs/framework/plugins)
- [Google AI Studio Keys](https://aistudio.google.com/app/api-keys)
- [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)

## License

MIT — see [LICENSE](../../LICENSE).
