"use server";

import { getDraftRunner, getPublishRunner } from "@/agents/coordinator/agent";
import {
	CHAR_LIMITS,
	type ArticlePreview,
	type Platform,
	type PlatformAvailability,
	type PostDraft,
	type PreviewResult,
	type PublishResult,
	type Tone,
} from "@/types";
import { env, getPlatformAvailability } from "../../../env";

// ───────────────────────────────────────────────────────────────────
// Singleton runners — avoid re-initializing MCP toolsets on every call.
// ───────────────────────────────────────────────────────────────────
let draftRunner: Awaited<ReturnType<typeof getDraftRunner>> | null = null;
let publishRunner: Awaited<ReturnType<typeof getPublishRunner>> | null = null;

async function ensureDraftRunner() {
	if (!draftRunner) draftRunner = await getDraftRunner();
	return draftRunner;
}

async function ensurePublishRunner() {
	if (!publishRunner) publishRunner = await getPublishRunner();
	return publishRunner;
}

// ───────────────────────────────────────────────────────────────────
// Server-side article cache (1 hour TTL).
// Keeps us from re-fetching the same URL when the user regenerates
// individual drafts or changes tone.
// ───────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 60 * 1000;
const articleCache = new Map<
	string,
	{ article: ArticlePreview; content: string; expiresAt: number }
>();

function getCachedArticle(url: string) {
	const entry = articleCache.get(url);
	if (!entry) return null;
	if (Date.now() > entry.expiresAt) {
		articleCache.delete(url);
		return null;
	}
	return entry;
}

function setCachedArticle(
	url: string,
	article: ArticlePreview,
	content: string,
) {
	articleCache.set(url, {
		article,
		content,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});
}

// ───────────────────────────────────────────────────────────────────
// Availability (read-only — read during SSR to decide which buttons
// to render).
// ───────────────────────────────────────────────────────────────────

export async function getAvailability(): Promise<{
	platforms: PlatformAvailability;
}> {
	return {
		platforms: getPlatformAvailability(),
	};
}

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function buildDraft(
	platform: Platform,
	content: string,
	hashtags: string[],
	thread?: string[],
): PostDraft {
	const charLimit = CHAR_LIMITS[platform];
	const charCount = thread
		? Math.max(...thread.map((p) => p.length))
		: content.length;
	return { platform, content, hashtags, thread, charCount, charLimit };
}

async function fetchArticleDirectly(url: string): Promise<{
	article: ArticlePreview;
	content: string;
} | null> {
	// Use the agent's fetch tool indirectly via a micro-prompt that asks for
	// only the article fetch, no draft generation. Easier: replicate the
	// fetch in-place to avoid a wasted LLM roundtrip.
	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (compatible; SocialMediaAgent/1.0; +https://github.com/IQAIcom/adk-ts)",
				Accept: "text/html,application/xhtml+xml,text/plain",
			},
		});
		if (!response.ok) return null;
		const html = await response.text();

		const extract = (patterns: RegExp[]) => {
			for (const p of patterns) {
				const m = html.match(p);
				if (m?.[1]) return m[1].trim();
			}
			return "";
		};
		const decode = (s: string) =>
			s
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#39;/g, "'")
				.replace(/&nbsp;/g, " ");

		const title = decode(
			extract([
				/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
				/<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i,
				/<title[^>]*>([^<]+)<\/title>/i,
			]),
		);
		const description = decode(
			extract([
				/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i,
				/<meta\s+name=["']twitter:description["']\s+content=["']([^"']+)["']/i,
				/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
			]),
		);
		const author = decode(
			extract([
				/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i,
				/<meta\s+property=["']article:author["']\s+content=["']([^"']+)["']/i,
			]),
		);
		const publishedAt = extract([
			/<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/i,
			/<time[^>]*datetime=["']([^"']+)["']/i,
		]);
		const image = extract([
			/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
			/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
		]);
		const siteName = decode(
			extract([
				/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i,
			]),
		);
		const content = html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
			.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		const maxLength = 6000;
		const truncated =
			content.length > maxLength
				? `${content.slice(0, maxLength)}... [truncated]`
				: content;

		const article: ArticlePreview = {
			url,
			title,
			description,
			author,
			publishedAt,
			image,
			siteName,
		};
		return { article, content: truncated };
	} catch {
		return null;
	}
}

async function ensureArticle(url: string) {
	const cached = getCachedArticle(url);
	if (cached) return cached;

	const fetched = await fetchArticleDirectly(url);
	if (!fetched) return null;

	setCachedArticle(url, fetched.article, fetched.content);
	return { ...fetched, expiresAt: Date.now() + CACHE_TTL_MS };
}

// ───────────────────────────────────────────────────────────────────
// Actions
// ───────────────────────────────────────────────────────────────────

/**
 * Generate drafts for all requested platforms.
 * Uses the server-side article cache so the second run with the same URL
 * (e.g., different tone or platform mix) is ~free.
 */
export async function previewPosts(params: {
	url: string;
	tone: Tone;
	platforms: Platform[];
	xThreadLength: number;
}): Promise<PreviewResult> {
	const { url, tone, platforms, xThreadLength } = params;
	const runner = await ensureDraftRunner();

	// Warm the cache so `regenerateDraft` and repeat calls are fast.
	const cached = await ensureArticle(url);

	const articleContext = cached
		? `Pre-fetched article metadata + content (do NOT call fetch_blog_post, use this directly):

TITLE: ${cached.article.title}
URL: ${cached.article.url}
DESCRIPTION: ${cached.article.description}
AUTHOR: ${cached.article.author}
SITE: ${cached.article.siteName}
PUBLISHED: ${cached.article.publishedAt}
IMAGE: ${cached.article.image}

CONTENT:
${cached.content}
`
		: `URL to fetch: ${url}`;

	const prompt = `Generate social media post drafts for this article:

${articleContext}

Tone: ${tone}
Platforms: ${platforms.join(", ")}
${platforms.includes("x") && xThreadLength > 1 ? `X mode: THREAD of ${xThreadLength} posts (populate \`thread\` array for x draft)` : "X mode: single post"}`;

	const result = (await runner.ask(prompt)) as {
		article: ArticlePreview;
		drafts: Array<{
			platform: Platform;
			content: string;
			thread?: string[];
			hashtags: string[];
		}>;
	};

	// If the agent fetched the article itself, cache that result too.
	if (!cached && result.article?.url) {
		setCachedArticle(result.article.url, result.article, "");
	}

	const drafts: PostDraft[] = result.drafts.map((d) =>
		buildDraft(d.platform, d.content, d.hashtags, d.thread),
	);

	return { article: cached?.article ?? result.article, drafts };
}

/**
 * Regenerate a single platform's draft using the cached article.
 * Cheap because the article was already fetched.
 */
export async function regenerateDraft(params: {
	url: string;
	platform: Platform;
	tone: Tone;
	xThreadLength: number;
}): Promise<PostDraft> {
	const { url, platform, tone, xThreadLength } = params;

	const cached = await ensureArticle(url);
	if (!cached) {
		throw new Error(
			"Article not in cache and could not be re-fetched. Please start over.",
		);
	}

	const runner = await ensureDraftRunner();

	const prompt = `Regenerate a single draft for this article. Use the provided content — do NOT call fetch_blog_post.

TITLE: ${cached.article.title}
URL: ${cached.article.url}
DESCRIPTION: ${cached.article.description}
AUTHOR: ${cached.article.author}
SITE: ${cached.article.siteName}

CONTENT:
${cached.content}

Tone: ${tone}
Platforms: ${platform}
${platform === "x" && xThreadLength > 1 ? `X mode: THREAD of ${xThreadLength} posts` : ""}

Return JSON with the article block AND exactly one draft for the requested platform. Make this draft noticeably different from a typical first attempt — try a fresh angle or hook.`;

	const result = (await runner.ask(prompt)) as {
		article: ArticlePreview;
		drafts: Array<{
			platform: Platform;
			content: string;
			thread?: string[];
			hashtags: string[];
		}>;
	};

	const match = result.drafts.find((d) => d.platform === platform);
	if (!match) {
		throw new Error(`Agent did not return a draft for platform: ${platform}`);
	}

	return buildDraft(match.platform, match.content, match.hashtags, match.thread);
}

/**
 * Publish a single post or thread to a platform.
 * Only works when credentials for that platform are configured — the UI
 * should check availability and hide the publish button otherwise.
 */
export async function publishPost(params: {
	platform: Platform;
	content: string;
	thread?: string[];
}): Promise<PublishResult> {
	const availability = getPlatformAvailability();
	if (!availability[params.platform]) {
		return {
			platform: params.platform,
			success: false,
			message: `No credentials configured for ${params.platform}. Use Copy to post manually.`,
		};
	}

	try {
		const runner = await ensurePublishRunner();

		const telegramContext =
			params.platform === "telegram" && env.TELEGRAM_CHAT_ID
				? `\nchatId: ${env.TELEGRAM_CHAT_ID}\n`
				: "";

		const prompt = `Publish to ${params.platform}:
${telegramContext}
${params.thread && params.thread.length > 1 ? `THREAD (${params.thread.length} posts):\n${params.thread.map((p, i) => `[${i + 1}] ${p}`).join("\n\n")}` : params.content}`;

		const response = await runner.ask(prompt);

		try {
			const parsed = JSON.parse(
				typeof response === "string" ? response : JSON.stringify(response),
			);
			return {
				platform: params.platform,
				success: parsed.success ?? true,
				message: parsed.message ?? "Published",
				url: parsed.url,
			};
		} catch {
			return {
				platform: params.platform,
				success: true,
				message: typeof response === "string" ? response : "Published",
			};
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			platform: params.platform,
			success: false,
			message: `Failed to publish: ${message}`,
		};
	}
}

