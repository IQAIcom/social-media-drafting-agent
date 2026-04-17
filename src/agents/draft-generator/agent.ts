import { AgentBuilder } from "@iqai/adk";
import z from "zod";
import { env } from "../../../env";
import { fetchBlogPostTool } from "./tools";

/**
 * Schema the draft generator must return.
 *
 * One draft per platform GROUP — the same text is later displayed for every
 * platform in that group. The agent never emits a per-platform draft.
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
			group: z.enum([
				"short-casual",
				"medium-community",
				"long-professional",
			]),
			content: z.string(),
			hashtags: z.array(z.string()),
		}),
	),
});

export type PostDraftsOutput = z.infer<typeof postDraftsSchema>;

/**
 * Creates the draft generator.
 *
 * Fetches the blog post (or accepts pre-cached metadata in the prompt) and
 * returns one draft per requested platform group. All char limits are passed
 * in the prompt — the agent does not guess them.
 */
export const getDraftGenerator = async () => {
	const { runner } = await AgentBuilder.create("draft_generator")
		.withDescription(
			"Fetches a blog post and generates platform-group-optimized social media drafts. Returns structured JSON.",
		)
		.withInstruction(
			`You are a social media content specialist. Given a blog post URL (or pre-fetched article content), a tone, and a list of target platform GROUPS with their hard character limits:

1. If the article content is already provided in the prompt, USE THAT — do NOT call fetch_blog_post again.
2. Otherwise, use the fetch_blog_post tool to read the article metadata and content.
3. For EACH requested group, generate exactly ONE draft. The same draft will be reused verbatim for every platform in that group — write it so it works for all of them.

   Group writing guidelines:
   - **short-casual** (X + Bluesky): Punchy hook, casual voice, 2-3 hashtags. Include the article URL. Must fit the char limit given in the prompt (counting hashtags + URL).
   - **medium-community** (Threads + Mastodon): Conversational, community-friendly. Federated-discovery hashtags are useful (1-3). Include the URL.
   - **long-professional** (LinkedIn): Polished, authoritative framing with a clear takeaway. 3-5 relevant hashtags at the end. Include the URL.

4. The hard character limit for each group is supplied in the prompt. NEVER exceed it. If you're close, trim — do not guess a higher limit.

5. Apply the requested tone:
   - **auto**: Pick a tone that fits each group (punchy for short-casual, conversational for medium-community, professional for long-professional).
   - **professional**: Polished, authoritative.
   - **casual**: Friendly, conversational.
   - **educational**: Explanatory, informative.
   - **punchy**: Bold, short sentences.

6. Return ONLY valid JSON matching the output schema. No markdown fences. The \`drafts\` array contains one entry per requested group, keyed by the group name.`,
		)
		.withModel(env.LLM_MODEL)
		.withTools(fetchBlogPostTool)
		.withOutputSchema(postDraftsSchema)
		.build();

	return runner;
};
