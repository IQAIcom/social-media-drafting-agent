<div align="center">
  <img src="https://files.catbox.moe/vumztw.png" alt="ADK-TS Logo" width="80" />
  <br/>
  <h1>Social Media Drafting Agent</h1>
  <b>Turn blog posts into platform-optimized social drafts</b>
  <br/>
  <i>Next.js • ADK-TS • Five platforms, grouped into three drafts</i>
</div>

---

Paste a blog post URL. The agent reads the article, drafts posts for **LinkedIn, X, Bluesky, Threads, and Mastodon** in the tone you pick, and lets you review, edit, and copy — all from one page. Publishing is intentionally out of scope: you copy each draft and post it yourself.

**Built with [ADK-TS](https://adk.iqai.com/) — the TypeScript-native AI agent framework.**

## What makes this different

The agent does not write one draft per platform. Instead, the five supported platforms are bucketed into three writing archetypes, and the agent writes exactly **one draft per group**. That draft is reused for every platform in the group.

| Group | Platforms | Char limit |
|---|---|---|
| `short-casual` | X, Bluesky | 280 |
| `medium-community` | Threads, Mastodon | 500 |
| `long-professional` | LinkedIn | 3000 |

**Worst case: 3 LLM drafts regardless of how many platforms you pick.** Char limits are passed to the agent in the prompt — it doesn't guess.

## Features

- **5 platforms, 3 drafts** — one tailored draft per platform group, not per platform
- **Copy-first** — no publishing step, no credentials, no OAuth. Every draft is copyable
- **Editable drafts** — tweak content inline. Live character counter against the group's hard limit
- **Regenerate per draft** — don't like the short-casual post but love the LinkedIn one? Regenerate just that group
- **Auto tone** — the agent picks a group-appropriate tone by default; or force professional / casual / educational / punchy across all
- **Rich article preview** — shows the article's cover image, title, description, author, and site name
- **Local history** — your 10 most recent articles are stored in your browser's localStorage. Click one to restore its drafts
- **Article cache** — fetched articles are cached server-side for 1 hour; regenerating drafts doesn't re-fetch
- **Copy all** — grab every draft formatted with group labels in one click

## How it works

```text
Browser (Next.js App Router)
   │
   ▼
Server Actions:
  previewPosts(url, tone, platforms)
       ↓ compute active groups from selected platforms
       ↓ check server-side cache
       ↓ fetch article if miss
       ↓ call Draft Generator Agent with group list + char limits
       ↓ return { article, drafts[] } (one per group)

  regenerateDraft(url, group, platforms, tone)
       ↓ read article from cache
       ↓ call Draft Generator for one group only
       ↓ return one fresh draft
```

Each server action reuses a cached agent runner (singleton) so the LLM client isn't re-initialized on every request.

## Design notes

- **Group-based drafts** — the five platforms collapse into three writing archetypes. Writing once per group keeps LLM cost bounded and avoids near-identical drafts across similar platforms (e.g., Threads vs Mastodon).
- **Explicit limits in the prompt** — the agent never guesses char limits; they're passed in every prompt.
- **Strongly typed agent output** — the draft generator uses `withOutputSchema` from ADK-TS to return typed JSON.
- **Session memory** — recent articles are saved to localStorage (not the server). Your history is private to your browser.

## Prerequisites

- Node.js ≥ 22
- pnpm
- Google AI API key ([aistudio.google.com/api-keys](https://aistudio.google.com/api-keys))

## Quick start

```bash
pnpm install
cp .env.example .env
# Edit .env — only GOOGLE_API_KEY is required.
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
│   ├── draft-generator/
│   │   ├── agent.ts                         # getDraftGenerator (withOutputSchema)
│   │   └── tools.ts                         # fetch_blog_post (metadata extraction)
│   └── coordinator/
│       └── agent.ts                         # getDraftRunner
├── app/
│   ├── page.tsx                             # Landing + tool
│   ├── _components/navbar.tsx               # Top navbar
│   └── demo/
│       ├── demo.tsx                         # Main UI (form, drafts, history)
│       └── _actions.ts                      # Server actions + article cache
├── components/ui/                           # shadcn primitives
├── lib/utils.ts                             # cn() utility
└── types.ts                                 # Platform / Group / Draft types
```

## Limitations

- **Text only** — no image uploads. The agent references the article's OG image in the preview card but doesn't attach it to posts.
- **No paywalls** — can't read articles behind login walls.
- **No publishing** — by design. Copy each draft and post it yourself.

## Learn more

- [ADK-TS docs](https://adk.iqai.com/)
- [ADK-TS plugins](https://adk.iqai.com/docs/framework/plugins)

---

**Built for demonstration.**
