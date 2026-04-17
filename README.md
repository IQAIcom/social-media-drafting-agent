<div align="center">
  <img src="https://files.catbox.moe/vumztw.png" alt="ADK-TS Logo" width="80" />
  <br/>
  <h1>Social Media Drafting Agent</h1>
  <b>Turn blog posts into platform-optimized social drafts</b>
  <br/>
  <i>Next.js • ADK-TS • Copy-first drafting</i>
</div>

---

Paste a blog post URL. The agent reads the article and drafts posts for **LinkedIn, X, Bluesky, Threads, and Mastodon** in the tone you pick, ready to copy and share.

**Built with [ADK-TS](https://adk.iqai.com/) — the TypeScript-native AI agent framework.**

## How it writes drafts

The five platforms are bucketed into three writing archetypes, and the agent writes exactly **one draft per group**. Each draft is reused for every platform in its group.

| Group | Platforms | Char limit |
|---|---|---|
| `short-casual` | X, Bluesky | 280 |
| `medium-community` | Threads, Mastodon | 500 |
| `long-professional` | LinkedIn | 3000 |

Worst case: 3 LLM drafts regardless of how many platforms you pick. Char limits are passed to the agent in the prompt — it doesn't guess.

## Features

- **Copy-first** — no publishing, no credentials, no OAuth
- **Editable drafts** — tweak content inline with a live character counter against each draft's hard limit
- **Regenerate any draft** — pick a different angle for a single draft without re-running everything (uses the cached article, so it's fast)
- **Auto tone** — the agent picks a fitting tone per draft, or force professional / casual / educational / punchy across all
- **Article preview** — shows cover image, title, description, author, and site name
- **Local history** — your 10 most recent articles are saved in localStorage; click one to restore its drafts
- **Article cache** — fetched articles are cached server-side for 1 hour, so regenerating is cheap
- **Copy all** — grab every draft with one click, formatted with clear section headers

## How it works

```text
Browser (Next.js App Router)
   │
   ▼
Server Actions (src/app/actions.ts):
  previewPosts(url, tone, platforms)
       ↓ compute active groups from selected platforms
       ↓ check server-side cache, fetch if miss
       ↓ call Draft Generator with group list + char limits
       ↓ return { article, drafts[] } (one per group)

  regenerateDraft(url, group, platforms, tone)
       ↓ read article from cache
       ↓ call Draft Generator for one group only
       ↓ return one fresh draft
```

The agent runner is cached as a singleton so the LLM client isn't re-initialized on every request.

## Prerequisites

- Node.js >= 22
- pnpm
- Google AI API key ([aistudio.google.com/api-keys](https://aistudio.google.com/api-keys))

## Quick start

```bash
pnpm install
cp .env.example .env
# Edit .env — set GOOGLE_API_KEY
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), paste a blog URL, pick tone + platforms, and click **Generate drafts**.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GOOGLE_API_KEY` | yes | — | Powers the Gemini LLM |
| `LLM_MODEL` | no | `gemini-2.5-flash` | LLM to use |
| `ADK_DEBUG` | no | `false` | Verbose agent logs |

## Project structure

```text
src/
├── agents/
│   └── draft-generator/
│       ├── agent.ts              # getDraftGenerator (withOutputSchema)
│       └── tools.ts              # fetch_blog_post tool (wraps lib/article-fetch)
├── app/
│   ├── _components/
│   │   ├── drafter.tsx           # main UI (form, drafts, history)
│   │   └── navbar.tsx            # top navbar
│   ├── actions.ts                # server actions (previewPosts, regenerateDraft)
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/ui/                # shadcn primitives
├── lib/
│   ├── article-fetch.ts          # shared HTML fetch + metadata parse
│   └── utils.ts                  # cn() utility
└── types.ts                      # Platform / Group / Draft types
```

## Limitations

- **Text only** — no image uploads. The agent references the article's OG image in the preview card but doesn't attach it to posts.
- **No paywalls** — can't read articles behind login walls.
- **No publishing** — by design. Copy each draft and post it yourself.

## Learn more

- [ADK-TS docs](https://adk.iqai.com/)
- [ADK-TS plugins](https://adk.iqai.com/docs/framework/plugins)
