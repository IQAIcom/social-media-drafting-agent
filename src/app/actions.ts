"use server";

import { getDraftGenerator } from "@/agents/draft-generator/agent";
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

// Singleton runner — avoid re-initializing on every call.
let draftRunner: Awaited<ReturnType<typeof getDraftGenerator>> | null = null;

async function ensureDraftRunner() {
	if (!draftRunner) draftRunner = await getDraftGenerator();
	return draftRunner;
}

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

/**
 * Generate drafts for every group that contains at least one of the
 * user's selected platforms. The agent fetches the article itself via
 * its built-in web_fetch tool.
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

	const prompt = `Generate one social media draft per requested group for this article.

URL to fetch with web_fetch: ${url}

Tone: ${tone}

Requested groups and their HARD character limits:
${buildGroupBrief(groups)}

Return exactly ${groups.length} draft${groups.length === 1 ? "" : "s"} — one per group listed above. Do NOT exceed any group's char limit.`;

	const result = (await runner.ask(prompt)) as AgentOutput;

	const drafts: GroupDraft[] = result.drafts
		.filter((d) => groups.includes(d.group))
		.map((d) => buildDraft(d.group, platforms, d.content, d.hashtags));

	return { article: result.article, drafts };
}

/**
 * Regenerate a single group's draft. The agent re-fetches the article —
 * fast enough for a demo, no cache needed.
 */
export async function regenerateDraft(params: {
	url: string;
	group: PlatformGroup;
	platforms: Platform[];
	tone: Tone;
}): Promise<GroupDraft> {
	const { url, group, platforms, tone } = params;

	const runner = await ensureDraftRunner();
	const spec = PLATFORM_GROUPS[group];

	const prompt = `Use web_fetch to read this article, then generate exactly one draft for the "${group}" group.

URL: ${url}

Tone: ${tone}

Group and HARD character limit:
- ${group} (char limit ${spec.charLimit}) — shared by: ${spec.platforms.join(", ")}

Return JSON with the article block AND exactly one draft for the "${group}" group. Try a fresh angle or hook so this feels different from a typical first attempt. Do NOT exceed the char limit.`;

	const result = (await runner.ask(prompt)) as AgentOutput;

	const match = result.drafts.find((d) => d.group === group);
	if (!match) {
		throw new Error(`Agent did not return a draft for group: ${group}`);
	}

	return buildDraft(match.group, platforms, match.content, match.hashtags);
}
