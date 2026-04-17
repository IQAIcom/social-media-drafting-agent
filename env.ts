import { config } from "dotenv";
import { z } from "zod";

config();

/**
 * Environment variable schema.
 *
 * Only GOOGLE_API_KEY is required (it powers the LLM).
 * Every platform's publishing credentials are optional — if they're not set,
 * that platform is "copy-only" (users copy the generated draft and post manually).
 *
 * Telegram notifications are optional — if the bot token and chat ID are not set,
 * the "Notify Telegram" button is hidden in the UI.
 */
export const envSchema = z.object({
	// Core
	ADK_DEBUG: z.coerce.boolean().default(false),
	GOOGLE_API_KEY: z.string().min(1, "GOOGLE_API_KEY is required"),
	LLM_MODEL: z.string().default("gemini-2.5-flash"),

	// LinkedIn — auto-publish if token is set
	LINKEDIN_ACCESS_TOKEN: z.string().optional(),

	// X / Twitter — auto-publish if all 4 are set
	TWITTER_APP_KEY: z.string().optional(),
	TWITTER_APP_SECRET: z.string().optional(),
	TWITTER_ACCESS_TOKEN: z.string().optional(),
	TWITTER_ACCESS_SECRET: z.string().optional(),

	// Bluesky — auto-publish if both are set
	BLUESKY_IDENTIFIER: z.string().optional(),
	BLUESKY_APP_PASSWORD: z.string().optional(),

	// Threads (Meta) — auto-publish if both are set
	THREADS_ACCESS_TOKEN: z.string().optional(),
	THREADS_USER_ID: z.string().optional(),

	// WhatsApp (Cloud API) — auto-publish if both are set
	WHATSAPP_ACCESS_TOKEN: z.string().optional(),
	WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

	// Mastodon — auto-publish if both are set
	MASTODON_ACCESS_TOKEN: z.string().optional(),
	MASTODON_INSTANCE_URL: z.string().optional(),

	// Telegram channel posting — auto-publish if both are set.
	// TELEGRAM_CHAT_ID is the target channel (e.g., "@mychannel" or "-1001234567890").
	TELEGRAM_BOT_TOKEN: z.string().optional(),
	TELEGRAM_CHAT_ID: z.string().optional(),
});

export const env = envSchema.parse(process.env);

/**
 * Returns which platforms have credentials configured for auto-publishing.
 * Platforms without credentials become copy-only in the UI.
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
		whatsapp: Boolean(
			env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID,
		),
		mastodon: Boolean(env.MASTODON_ACCESS_TOKEN && env.MASTODON_INSTANCE_URL),
		telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
	};
}
