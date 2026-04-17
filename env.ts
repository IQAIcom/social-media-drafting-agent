import { config } from "dotenv";
import { z } from "zod";

config();

/**
 * Environment variable schema.
 *
 * Only GOOGLE_API_KEY is required — it powers the draft generator LLM.
 * Platform credentials are optional and only consumed by the publisher agent.
 */
export const envSchema = z.object({
	// Core
	ADK_DEBUG: z.coerce.boolean().default(false),
	GOOGLE_API_KEY: z.string().min(1, "GOOGLE_API_KEY is required"),
	LLM_MODEL: z.string().default("gemini-2.5-flash"),

	// LinkedIn
	LINKEDIN_ACCESS_TOKEN: z.string().optional(),

	// X / Twitter
	TWITTER_APP_KEY: z.string().optional(),
	TWITTER_APP_SECRET: z.string().optional(),
	TWITTER_ACCESS_TOKEN: z.string().optional(),
	TWITTER_ACCESS_SECRET: z.string().optional(),

	// Bluesky
	BLUESKY_IDENTIFIER: z.string().optional(),
	BLUESKY_APP_PASSWORD: z.string().optional(),

	// Threads (Meta)
	THREADS_ACCESS_TOKEN: z.string().optional(),
	THREADS_USER_ID: z.string().optional(),

	// WhatsApp (Cloud API)
	WHATSAPP_ACCESS_TOKEN: z.string().optional(),
	WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

	// Mastodon
	MASTODON_ACCESS_TOKEN: z.string().optional(),
	MASTODON_INSTANCE_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);

/**
 * Returns which in-scope platforms have credentials configured for
 * auto-publishing. Platforms without credentials stay copy-only in the UI.
 *
 * WhatsApp is supported by the publisher agent but is out of scope for
 * this drafting UI, so it's not surfaced here.
 */
export function getPlatformAvailability() {
	return {
		linkedin: Boolean(env.LINKEDIN_ACCESS_TOKEN),
		x: Boolean(
			env.TWITTER_APP_KEY &&
				env.TWITTER_APP_SECRET &&
				env.TWITTER_ACCESS_TOKEN &&
				env.TWITTER_ACCESS_SECRET,
		),
		bluesky: Boolean(env.BLUESKY_IDENTIFIER && env.BLUESKY_APP_PASSWORD),
		threads: Boolean(env.THREADS_ACCESS_TOKEN && env.THREADS_USER_ID),
		mastodon: Boolean(env.MASTODON_ACCESS_TOKEN && env.MASTODON_INSTANCE_URL),
	};
}
