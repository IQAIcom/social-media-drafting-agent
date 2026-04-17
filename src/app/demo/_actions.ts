"use server";

import { getDraftRunner } from "@/agents/coordinator/agent";
import {
	type ArticlePreview,
	type GroupDraft,
	groupsForPlatforms,
	PLATFORM_GROUPS,
	type Platform,
	type PlatformGroup,
	type PreviewResult,
	type Tone,
} from "@/types";

// ───────────────────────────────────────────────────────────────────
// Singleton runner — avoid re-initializing on every call.
// ───────────────────────────────────────────────────────────────────
let draftRunner: Awaited<ReturnType<typeof getDraftRunner>> | null = null;

async function ensureDraftRunner() {
	if (!draftRunner) draftRunner = await getDraftRunner();
	return draftRunner;
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
// Helpers
// ───────────────────────────────────────────────────────────────────

function buildDraft(
	group: PlatformGroup,
	selectedPlatforms: Platform[],
	content: string,
	hashtags: string[],
): GroupDraft {
	const spec = PLATFORM_GROUPS[group];
	const selectedSet = new Set(selectedPlatforms);
	return {
		group,
		platforms: spec.platforms.filter((p) => selectedSet.has(p)),
		content,
		hashtags,
		charLimit: spec.charLimit,
		charCount: content.length,
	};
}

function buildGroupBrief(groups: PlatformGroup[]): string {
	return groups
		.map((g) => {
			const spec = PLATFORM_GROUPS[g];
			return `- ${g} (char limit ${spec.charLimit}) — shared by: ${spec.platforms.join(", ")}`;
		})
		.join("\n");
}

async function fetchArticleDirectly(url: string): Promise<{
	article: ArticlePreview;
	content: string;
} | null> {
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
 * Generate drafts for every group that contains at least one of the
 * user's selected platforms. Uses the server-side article cache so
 * repeat calls (regenerate, different tone) are ~free.
 */
export async function previewPosts(params: {
	url: string;
	tone: Tone;
	platforms: Platform[];
}): Promise<PreviewResult> {
	const { url, tone, platforms } = params;
	const groups = groupsForPlatforms(platforms);
	if (groups.length === 0) {
		throw new Error("Select at least one platform.");
	}

	const runner = await ensureDraftRunner();
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

	const prompt = `Generate one social media draft per requested group for this article.

${articleContext}

Tone: ${tone}

Requested groups and their HARD character limits:
${buildGroupBrief(groups)}

Return exactly ${groups.length} draft${groups.length === 1 ? "" : "s"} — one per group listed above. Do NOT exceed any group's char limit.`;

	const result = (await runner.ask(prompt)) as {
		article: ArticlePreview;
		drafts: Array<{
			group: PlatformGroup;
			content: string;
			hashtags: string[];
		}>;
	};

	if (!cached && result.article?.url) {
		setCachedArticle(result.article.url, result.article, "");
	}

	const drafts: GroupDraft[] = result.drafts
		.filter((d) => groups.includes(d.group))
		.map((d) => buildDraft(d.group, platforms, d.content, d.hashtags));

	return { article: cached?.article ?? result.article, drafts };
}

/**
 * Regenerate a single group's draft using the cached article.
 * Cheap because the article was already fetched.
 */
export async function regenerateDraft(params: {
	url: string;
	group: PlatformGroup;
	platforms: Platform[];
	tone: Tone;
}): Promise<GroupDraft> {
	const { url, group, platforms, tone } = params;

	const cached = await ensureArticle(url);
	if (!cached) {
		throw new Error(
			"Article not in cache and could not be re-fetched. Please start over.",
		);
	}

	const runner = await ensureDraftRunner();
	const spec = PLATFORM_GROUPS[group];

	const prompt = `Regenerate a single draft for this article. Use the provided content — do NOT call fetch_blog_post.

TITLE: ${cached.article.title}
URL: ${cached.article.url}
DESCRIPTION: ${cached.article.description}
AUTHOR: ${cached.article.author}
SITE: ${cached.article.siteName}

CONTENT:
${cached.content}

Tone: ${tone}

Requested group and HARD character limit:
- ${group} (char limit ${spec.charLimit}) — shared by: ${spec.platforms.join(", ")}

Return JSON with the article block AND exactly one draft for the "${group}" group. Make this draft noticeably different from a typical first attempt — try a fresh angle or hook. Do NOT exceed the char limit.`;

	const result = (await runner.ask(prompt)) as {
		article: ArticlePreview;
		drafts: Array<{
			group: PlatformGroup;
			content: string;
			hashtags: string[];
		}>;
	};

	const match = result.drafts.find((d) => d.group === group);
	if (!match) {
		throw new Error(`Agent did not return a draft for group: ${group}`);
	}

	return buildDraft(match.group, platforms, match.content, match.hashtags);
}
