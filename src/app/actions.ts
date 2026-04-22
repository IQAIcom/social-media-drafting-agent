"use server";

import type {
	Platform,
	PlatformDraft,
	PostFormat,
	PreviewResult,
	Tone,
} from "@/types";

const NOT_IMPLEMENTED =
	"Not implemented yet — build the agent at src/agents/draft-generator/agent.ts and wire it up here. Follow along with the blog post.";

/**
 * TODO (blog step 5) — Generate one draft per selected platform.
 *
 * You'll call your `draft_generator` agent with a prompt that injects
 * the URL, tone, per-platform char limits, and thread length, then map
 * the agent's structured output into `PlatformDraft[]`.
 */
export async function previewPosts(_params: {
	url: string;
	tone: Tone;
	platforms: Platform[];
	format: PostFormat;
	threadLength: number;
}): Promise<PreviewResult> {
	throw new Error(NOT_IMPLEMENTED);
}

/**
 * TODO (blog step 5) — Regenerate a single platform's draft.
 *
 * This is the hook that makes the "Rewrite" button useful. You'll call
 * the same agent with a one-platform prompt and return the fresh draft.
 * In blog step 6 you'll add a plugin so this doesn't re-fetch the article.
 */
export async function regenerateDraft(_params: {
	url: string;
	platform: Platform;
	tone: Tone;
	format: PostFormat;
	threadLength: number;
}): Promise<PlatformDraft> {
	throw new Error(NOT_IMPLEMENTED);
}
