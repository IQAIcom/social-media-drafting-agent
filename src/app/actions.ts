"use server";

import { getDraftGenerator } from "@/agents/draft-generator/agent";
import { fetchArticle } from "@/lib/article-fetch";
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
let draftRunner: Awaited<ReturnType<typeof getDraftGenerator>> | null = null;

async function ensureDraftRunner() {
	if (!draftRunner) draftRunner = await getDraftGenerator();
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

async function ensureArticle(url: string) {
	const entry = articleCache.get(url);
	if (entry && Date.now() <= entry.expiresAt) return entry;
	if (entry) articleCache.delete(url);

	const fetched = await fetchArticle(url);
	if (!fetched) return null;

	const cached = {
		article: fetched.article,
		content: fetched.content,
		expiresAt: Date.now() + CACHE_TTL_MS,
	};
	articleCache.set(url, cached);
	return cached;
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

type AgentOutput = {
	article: ArticlePreview;
	drafts: Array<{
		group: PlatformGroup;
		content: string;
		hashtags: string[];
	}>;
};

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

	const result = (await runner.ask(prompt)) as AgentOutput;

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

	const result = (await runner.ask(prompt)) as AgentOutput;

	const match = result.drafts.find((d) => d.group === group);
	if (!match) {
		throw new Error(`Agent did not return a draft for group: ${group}`);
	}

	return buildDraft(match.group, platforms, match.content, match.hashtags);
}
