import { AgentBuilder, WebFetchTool } from "@iqai/adk";
import z from "zod";
import { env } from "../../../env";

/**
 * Schema the draft generator must return. One draft per target platform.
 * For X or Threads in thread mode, `segments` carries the chained posts.
 */
export const postDraftsSchema = z.object({
	article: z.object({
		url: z.string(),
		title: z.string(),
	}),
	drafts: z.array(
		z.object({
			platform: z.enum(["linkedin", "x", "threads"]),
			content: z.string(),
			segments: z.array(z.string()).optional(),
			hashtags: z.array(z.string()),
		}),
	),
});

export type PostDraftsOutput = z.infer<typeof postDraftsSchema>;

/**
 * Creates the draft generator. Uses ADK-TS's built-in `web_fetch` tool to read
 * the article, then returns one draft per requested platform. Char limits and
 * format (single post vs chained thread for X/Threads) are passed explicitly
 * in the prompt.
 */
export const getDraftGenerator = async () => {
	const { runner } = await AgentBuilder.create("draft_generator")
		.withDescription(
			"Fetches a blog post and generates platform-optimized social media drafts. Returns structured JSON.",
		)
		.withInstruction(
			`You are a social media content specialist. Given a blog post URL, a tone, and a list of target platforms with their hard character limits and formats:

1. Use the web_fetch tool to read the article. Record its title.
2. For EACH requested platform, generate exactly ONE draft tailored to that platform.

   Platform writing guidelines:
   - **x** (post): Single punchy post with hook, casual voice, 2-3 hashtags. Include the article URL. Fit the 280-char limit (counting hashtags + URL).
   - **x** (thread): A chained thread of exactly the requested number of posts. Each post MUST be <=280 characters on its own. Post 1 is the hook. Middle posts develop the idea. Final post includes the article URL and 1-3 hashtags. Return the full array in \`segments\` (one string per post, in order) AND a plain \`content\` string with the segments joined by two newlines.
   - **threads** (post): Single conversational, community-friendly post. 1-3 hashtags. Include the URL. Fit the 500-char limit.
   - **threads** (thread): A chained thread of exactly the requested number of posts. Each post MUST be <=500 characters on its own. Post 1 is the hook. Middle posts develop the idea. Final post includes the article URL and 1-3 hashtags. Return the full array in \`segments\` AND a joined \`content\` string.
   - **linkedin**: Polished, authoritative single post with a clear takeaway. 3-5 hashtags at the end. Include the URL. (LinkedIn is always a single post — ignore thread settings.)

3. Character limits in the prompt are HARD — never exceed them. For thread format, each segment must independently fit its platform's per-post limit. Trim if close.

4. When asked for a thread of N posts, return EXACTLY N segments — not fewer, not more.

5. Apply the requested tone:
   - **auto**: Pick a tone that fits each platform (punchy for X, conversational for Threads, professional for LinkedIn).
   - **professional / casual / educational / punchy**: Apply uniformly.

6. Return ONLY valid JSON matching the output schema. No markdown fences. The \`article\` block must include the URL and the fetched title. Each draft must include \`content\`; threads in thread format must ALSO include \`segments\`. Do NOT include \`segments\` for single-post formats or for LinkedIn.`,
		)
		.withModel(env.LLM_MODEL)
		.withTools(new WebFetchTool())
		.withOutputSchema(postDraftsSchema)
		.build();

	return runner;
};
