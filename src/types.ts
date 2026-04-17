/**
 * Shared types for the social media posting workflow.
 */

export type Platform =
	| "linkedin"
	| "x"
	| "bluesky"
	| "threads"
	| "whatsapp"
	| "mastodon"
	| "telegram";

export type Tone =
	| "auto"
	| "professional"
	| "casual"
	| "educational"
	| "punchy";

export type PostDraft = {
	platform: Platform;
	/** Single-post content. For X threads, this is the joined preview (for copy). */
	content: string;
	/** Individual posts in an X thread — only present when the X draft is a thread. */
	thread?: string[];
	hashtags: string[];
	/** Character count of the single post, or the longest post in the thread. */
	charCount: number;
	/** Max char count per post for this platform. */
	charLimit: number;
};

export type ArticlePreview = {
	url: string;
	title: string;
	description: string;
	author: string;
	publishedAt: string;
	image: string;
	siteName: string;
};

export type PreviewResult = {
	article: ArticlePreview;
	drafts: PostDraft[];
};

export type PublishResult = {
	platform: Platform;
	success: boolean;
	message: string;
	url?: string;
};

/** Character limit per post for each platform. */
export const CHAR_LIMITS: Record<Platform, number> = {
	linkedin: 3000,
	x: 280,
	bluesky: 300,
	threads: 500,
	whatsapp: 700,
	mastodon: 500,
	telegram: 4096,
};

/** Display metadata for each platform. Icons are looked up in the UI layer. */
export const PLATFORM_LABELS: Record<Platform, string> = {
	linkedin: "LinkedIn",
	x: "X (Twitter)",
	bluesky: "Bluesky",
	threads: "Threads",
	whatsapp: "WhatsApp status",
	mastodon: "Mastodon",
	telegram: "Telegram channel",
};

/**
 * Which platforms this deployment can auto-publish to.
 * Computed at runtime from configured environment variables.
 * Platforms not listed are copy-only.
 */
export type PlatformAvailability = Record<Platform, boolean>;
