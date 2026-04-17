import { AgentBuilder } from "@iqai/adk";
import z from "zod";
import { env } from "../../../env";
import { fetchBlogPostTool } from "./tools";

/**
 * Schema the draft generator must return.
 * The `thread` field is only populated when the platform is "x" and the
 * user requested a thread (xThreadLength > 1).
 */
export const postDraftsSchema = z.object({
	article: z.object({
		url: z.string(),
		title: z.string(),
		description: z.string(),
		author: z.string(),
		publishedAt: z.string(),
		image: z.string(),
		siteName: z.string(),
	}),
	drafts: z.array(
		z.object({
			platform: z.enum([
				"linkedin",
				"x",
				"bluesky",
				"threads",
				"whatsapp",
				"mastodon",
				"telegram",
			]),
			content: z.string(),
			thread: z.array(z.string()).optional(),
			hashtags: z.array(z.string()),
		}),
	),
});

export type PostDraftsOutput = z.infer<typeof postDraftsSchema>;

/**
 * Creates the draft generator.
 *
 * Fetches the blog post (or accepts pre-cached metadata in the prompt)
 * and returns structured drafts for each requested platform. Does not publish.
 */
export const getDraftGenerator = async () => {
	const { runner } = await AgentBuilder.create("draft_generator")
		.withDescription(
			"Fetches a blog post and generates platform-optimized social media drafts. Returns structured JSON.",
		)
		.withInstruction(
			`You are a social media content specialist. Given a blog post URL (or pre-fetched article content), a tone, and a list of target platforms:

1. If the article content is already provided in the prompt, USE THAT — do NOT call fetch_blog_post again.
2. Otherwise, use the fetch_blog_post tool to read the article metadata and content.
3. For each requested platform, generate ONE draft applying the platform's best practices:

   - **linkedin** (limit: 3000 chars): Professional framing. 3-5 relevant hashtags at the end. Include the original URL.
   - **x** single post (limit: 280 chars INCLUDING hashtags + URL): Punchy hook. 2-3 hashtags.
   - **x** THREAD (when xThreadLength > 1): Generate exactly that many posts, each under 280 chars. First post hooks, middle posts explain, last post summarizes and links back. Populate BOTH \`content\` (joined preview with "\\n\\n— 2/N —\\n\\n" separators) AND \`thread\` (array of individual posts).
   - **bluesky** (limit: 300 chars): Casual tone typical of Bluesky community. 2-3 hashtags.
   - **threads** (limit: 500 chars): Conversational, Instagram-adjacent tone. Minimal hashtags (0-2).
   - **whatsapp** (limit: 700 chars): Personal, shareable. Use emojis sparingly. Include URL.
   - **mastodon** (limit: 500 chars): Community-friendly, hashtags useful for federated discovery.
   - **telegram** (limit: 4096 chars): Channel post. Can use Markdown formatting (bold, italic, links). Conversational, share the key takeaways from the article, include the link. Minimal hashtags (0-2).

4. Apply the requested tone:
   - **auto**: Pick a tone that fits each platform's culture (professional for linkedin, casual for bluesky/threads, punchy for x, etc.)
   - **professional**: Polished, authoritative
   - **casual**: Friendly, conversational
   - **educational**: Explanatory, informative
   - **punchy**: Bold, short sentences

5. Return ONLY valid JSON matching the output schema. No markdown fences.`,
		)
		.withModel(env.LLM_MODEL)
		.withTools(fetchBlogPostTool)
		.withOutputSchema(postDraftsSchema)
		.build();

	return runner;
};
