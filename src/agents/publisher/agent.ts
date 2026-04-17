import { LlmAgent, McpTelegram, McpToolset } from "@iqai/adk";
import { env } from "../../../env";

/**
 * Creates the publisher agent.
 *
 * Combines tools from `social-mcp` (LinkedIn, X, Bluesky, Threads, WhatsApp,
 * Mastodon) and `@iqai/mcp-telegram` (channel posting) so a single agent can
 * publish to any supported platform. When a platform's tool isn't available,
 * it reports an error and the UI falls back to copy-only.
 */
export const getPublisherAgent = async () => {
	const socialMcp = new McpToolset({
		name: "Social Media MCP Client",
		description: "Post to social platforms via social-mcp",
		debug: env.ADK_DEBUG,
		retryOptions: { maxRetries: 2, initialDelay: 200 },
		transport: {
			mode: "stdio",
			command: "npx",
			args: ["-y", "social-mcp"],
			env: {
				LINKEDIN_ACCESS_TOKEN: env.LINKEDIN_ACCESS_TOKEN ?? "",
				TWITTER_APP_KEY: env.TWITTER_APP_KEY ?? "",
				TWITTER_APP_SECRET: env.TWITTER_APP_SECRET ?? "",
				TWITTER_ACCESS_TOKEN: env.TWITTER_ACCESS_TOKEN ?? "",
				TWITTER_ACCESS_SECRET: env.TWITTER_ACCESS_SECRET ?? "",
				BLUESKY_IDENTIFIER: env.BLUESKY_IDENTIFIER ?? "",
				BLUESKY_APP_PASSWORD: env.BLUESKY_APP_PASSWORD ?? "",
				THREADS_ACCESS_TOKEN: env.THREADS_ACCESS_TOKEN ?? "",
				THREADS_USER_ID: env.THREADS_USER_ID ?? "",
				WHATSAPP_ACCESS_TOKEN: env.WHATSAPP_ACCESS_TOKEN ?? "",
				WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
				MASTODON_ACCESS_TOKEN: env.MASTODON_ACCESS_TOKEN ?? "",
				MASTODON_INSTANCE_URL: env.MASTODON_INSTANCE_URL ?? "",
				PATH: process.env.PATH || "",
			},
		},
	});
	const socialTools = await socialMcp.getTools();

	// Only spin up the Telegram MCP client if the bot token is configured.
	const telegramTools = env.TELEGRAM_BOT_TOKEN
		? await McpTelegram({
				env: { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN },
			}).getTools()
		: [];

	const agent = new LlmAgent({
		name: "publisher_agent",
		description:
			"Publishes social media posts and threads to the requested platform.",
		model: env.LLM_MODEL,
		instruction: `You are a social media publisher. You receive a request with:
- platform: "linkedin" | "x" | "bluesky" | "threads" | "whatsapp" | "mastodon" | "telegram"
- content: single-post text to publish (or joined thread text for preview)
- thread?: array of individual posts if publishing a thread

Routing:
- For **telegram**: use the Telegram MCP send-message tool. The target chat id will be provided in the prompt as \`chatId\`. Send the content as a Markdown-formatted message.
- For all other platforms: use the social-mcp tool for that platform.

Publish the content EXACTLY AS PROVIDED — do not rewrite.

For threads (when \`thread\` array is provided), attempt to use the thread-capable tool if available. Fall back to publishing only the first post if threading isn't supported.

Return a JSON object:
{ "platform": "...", "success": true|false, "message": "...", "url": "post-url-if-available" }

If the tool for the requested platform isn't available, return success: false with a clear message.`,
		tools: [...socialTools, ...telegramTools],
	});

	return agent;
};
