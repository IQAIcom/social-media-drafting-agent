/**
 * Shared types for the content-drafting workflow.
 *
 * This project focuses on *drafting* social media copy from a blog post —
 * publishing is intentionally out of scope. We generate one draft per
 * platform group (see PLATFORM_GROUPS below) and reuse it for every
 * platform in that group. Worst case: 3 LLM drafts regardless of how
 * many platforms the user picks.
 */

export type Platform =
	| "linkedin"
	| "x"
	| "bluesky"
	| "threads"
	| "mastodon";

export type PlatformGroup =
	| "short-casual"
	| "medium-community"
	| "long-professional";

export type Tone =
	| "auto"
	| "professional"
	| "casual"
	| "educational"
	| "punchy";

export type PlatformGroupSpec = {
	platforms: Platform[];
	charLimit: number;
	label: string;
	description: string;
};

/**
 * The three draft archetypes. One LLM draft is generated per group and
 * reused across every platform in that group.
 */
export const PLATFORM_GROUPS: Record<PlatformGroup, PlatformGroupSpec> = {
	"short-casual": {
		platforms: ["x", "bluesky"],
		charLimit: 280,
		label: "Short & casual",
		description: "One punchy post shared by X and Bluesky.",
	},
	"medium-community": {
		platforms: ["threads", "mastodon"],
		charLimit: 500,
		label: "Medium community",
		description: "A conversational post shared by Threads and Mastodon.",
	},
	"long-professional": {
		platforms: ["linkedin"],
		charLimit: 3000,
		label: "Long-form professional",
		description: "An in-depth post for LinkedIn.",
	},
};

export const PLATFORM_LABELS: Record<Platform, string> = {
	linkedin: "LinkedIn",
	x: "X (Twitter)",
	bluesky: "Bluesky",
	threads: "Threads",
	mastodon: "Mastodon",
};

/** Platforms the user can pick. Order is the display order. */
export const ALL_PLATFORMS: Platform[] = [
	"linkedin",
	"x",
	"bluesky",
	"threads",
	"mastodon",
];

/**
 * Given a set of selected platforms, return the groups that contain at
 * least one of them — ordered by the canonical group order below.
 */
const GROUP_ORDER: PlatformGroup[] = [
	"long-professional",
	"medium-community",
	"short-casual",
];

export const groupsForPlatforms = (selected: Platform[]): PlatformGroup[] => {
	const set = new Set(selected);
	return GROUP_ORDER.filter((g) =>
		PLATFORM_GROUPS[g].platforms.some((p) => set.has(p)),
	);
};

export type GroupDraft = {
	group: PlatformGroup;
	/** Platforms (from the user's selection) that this draft applies to. */
	platforms: Platform[];
	content: string;
	hashtags: string[];
	charLimit: number;
	charCount: number;
};

export type ArticlePreview = {
	url: string;
	title: string;
};

export type PreviewResult = {
	article: ArticlePreview;
	drafts: GroupDraft[];
};
