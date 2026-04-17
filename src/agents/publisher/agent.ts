import { LlmAgent, McpToolset } from "@iqai/adk";
import { env } from "../../../env";

/**
 * Creates the publisher agent.
 *
 * Uses tools from `social-mcp` to publish to LinkedIn, X, Bluesky, Threads,
 * WhatsApp, and Mastodon. When a platform's tool isn't available (no
 * credentials), it reports an error and the UI falls back to copy-only.
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

	const agent = new LlmAgent({
		name: "publisher_agent",
		description:
			"Publishes a social media post to the requested platform.",
		model: env.LLM_MODEL,
		instruction: `You are a social media publisher. You receive a request with:
- platform: "linkedin" | "x" | "bluesky" | "threads" | "whatsapp" | "mastodon"
- content: the post text to publish

Use the social-mcp tool for the requested platform.

Publish the content EXACTLY AS PROVIDED — do not rewrite.

Return a JSON object:
{ "platform": "...", "success": true|false, "message": "...", "url": "post-url-if-available" }

If the tool for the requested platform isn't available, return success: false with a clear message.`,
		tools: socialTools,
	});

	return agent;
};
