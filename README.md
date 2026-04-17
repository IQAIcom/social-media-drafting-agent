<div align="center">
  <img src="https://files.catbox.moe/vumztw.png" alt="ADK-TS Logo" width="80" />
  <br/>
  <h1>Social Media Posting Agent</h1>
  <b>Turn blog posts into platform-optimized social posts</b>
  <br/>
  <i>Next.js • ADK-TS • Multi-agent • MCP tools • Seven platforms</i>
</div>

---

Paste a blog post URL. The agent reads the article, drafts posts for **LinkedIn, X, Bluesky, Threads, WhatsApp, Mastodon, and Telegram channels** in the tone you pick, and lets you review, edit, copy, and publish — all from one page. Publish directly to the platforms you've configured; copy the rest and paste them manually.

**Built with [ADK-TS](https://adk.iqai.com/) — the TypeScript-native AI agent framework.**

## Features

- **7 platforms out of the box** — LinkedIn, X, Bluesky, Threads, WhatsApp status, Mastodon, Telegram (channel posting)
- **X threads** — generate a thread of any length (default 4), with a preview per post
- **Copy or publish** — every draft is copyable; auto-publish works on platforms you've configured with API credentials
- **Editable drafts** — tweak content inline before posting. Live character counter against platform limits
- **Regenerate per draft** — don't like the X post but love the LinkedIn one? Regenerate just that one (uses the cached article, so it's fast and cheap)
- **Auto tone** — the agent picks a platform-appropriate tone by default; or force professional / casual / educational / punchy across all
- **Rich article preview** — shows the article's cover image, title, description, author, and site name
- **Local history** — your 10 most recent articles are stored in your browser's localStorage. Click one to restore its drafts and publish history
- **Article cache** — fetched articles are cached server-side for 1 hour; regenerating drafts doesn't re-fetch
- **Copy all** — grab every draft formatted with platform labels in one click

## How it works

```text
Browser (Next.js App Router)
   │
   ▼
Server Actions:
  previewPosts(url, tone, platforms, xThreadLength)
       ↓ check server-side cache
       ↓ fetch article if miss
       ↓ call Draft Generator Agent (structured JSON via withOutputSchema)
       ↓ return { article, drafts[] }

  regenerateDraft(url, platform, tone, xThreadLength)
       ↓ read article from cache
       ↓ call Draft Generator for one platform only
       ↓ return one fresh draft

  publishPost(platform, content, thread?)
       ↓ check credentials exist
       ↓ call Publisher Agent → social-mcp (LinkedIn/X/Bluesky/…)
                              → @iqai/mcp-telegram (Telegram channels)

  getAvailability()
       ↓ read env vars, return which platforms can auto-publish
```

Each server action reuses a cached agent runner (singleton) so MCP toolsets aren't re-initialized on every request.

## Design notes

- **Preview-first** — the draft generator uses `withOutputSchema` from ADK-TS to return strongly typed JSON. Publishing is always a separate, explicit user action.
- **Availability-driven UI** — the server checks which platform credentials are configured and returns a map. The frontend hides the publish button and shows a "copy-only" badge for platforms you haven't set up.
- **Agent caching** — the article cache is keyed by URL with a 1-hour TTL. Regenerating a single draft costs one LLM call, not a fetch + LLM call.
- **Session memory** — recent articles are saved to localStorage (not the server). Your history is private to your browser.

## Prerequisites

- Node.js ≥ 22
- pnpm
- Google AI API key ([aistudio.google.com/api-keys](https://aistudio.google.com/api-keys))
- (Optional) Platform API credentials — see table below
- (Optional) Telegram bot token + chat ID for notifications

## Quick start

```bash
pnpm install
cp .env.example .env
# Edit .env — only GOOGLE_API_KEY is required. Add platform tokens for the ones you want to auto-publish.
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), paste a blog URL, pick tone + platforms, and click **Generate drafts**.

## Environment variables

**Required:**

| Variable | Purpose |
|---|---|
| `GOOGLE_API_KEY` | Powers the Gemini LLM |

**Optional — set to enable auto-publishing on that platform:**

| Platform | Variables |
|---|---|
| LinkedIn | `LINKEDIN_ACCESS_TOKEN` |
| X / Twitter | `TWITTER_APP_KEY`, `TWITTER_APP_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` |
| Bluesky | `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD` |
| Threads | `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` |
| WhatsApp | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| Mastodon | `MASTODON_ACCESS_TOKEN`, `MASTODON_INSTANCE_URL` |
| Telegram channel | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (e.g. `@mychannel` or `-100123...`). The bot must be an admin of the channel. |

**Optional — configuration:**

| Variable | Default | Purpose |
|---|---|---|
| `LLM_MODEL` | `gemini-2.5-flash` | LLM to use |
| `ADK_DEBUG` | `false` | Verbose agent logs |

## Project structure

```text
src/
├── agents/
│   ├── draft-generator/
│   │   ├── agent.ts                         # getDraftGenerator (withOutputSchema)
│   │   └── tools.ts                         # fetch_blog_post (metadata extraction)
│   ├── publisher/
│   │   └── agent.ts                         # getPublisherAgent (social-mcp + Telegram)
│   └── coordinator/
│       └── agent.ts                         # getDraftRunner, getPublishRunner
├── app/
│   ├── page.tsx                             # Landing + tool
│   ├── _components/navbar.tsx               # Top navbar
│   └── demo/
│       ├── demo.tsx                         # Main UI (form, drafts, history, publish)
│       └── _actions.ts                      # Server actions + article cache
├── components/ui/                           # shadcn primitives
├── lib/utils.ts                             # cn() utility
└── types.ts                                 # Shared Platform / Tone / Draft types
```

This follows the [recommended ADK-TS multi-agent project structure](https://adk.iqai.com/docs/framework/agents): one folder per agent, each owning its `agent.ts` and any agent-specific tools. The `coordinator/` folder orchestrates the others.

## Limitations

- **Text only** — no image uploads. The agent references the article's OG image in the preview card but doesn't attach it to posts.
- **No scheduling** — posts immediately when you click Publish.
- **No paywalls** — can't read articles behind login walls.
- **Publishing support depends on `social-mcp`** — if `social-mcp` doesn't expose a tool for a given platform, publishing returns an error and you fall back to Copy.
- **X thread publishing** — attempted via `social-mcp` if available; if threading isn't supported by the MCP tool, the publisher may only post the first entry. Copy always works for the full thread.
- **No analytics** — doesn't track post performance.

## Learn more

- [ADK-TS docs](https://adk.iqai.com/)
- [ADK-TS plugins](https://adk.iqai.com/docs/framework/plugins)
- [social-mcp](https://www.npmjs.com/package/social-mcp)
- [@iqai/mcp-telegram](https://www.npmjs.com/package/@iqai/mcp-telegram)

---

**Built for demonstration.** Production use requires careful review of auth tokens, rate limits, and platform API terms.
