import { AgentBuilder, WebFetchTool } from "@iqai/adk";
import z from "zod";
import { env } from "../../../env";

/**
 * Schema the draft generator must return.
 *
 * One draft per platform GROUP — the same text is later displayed for every
 * platform in that group.
 */
export const postDraftsSchema = z.object({
	article: z.object({
		url: z.string(),
		title: z.string(),
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
 * Uses ADK-TS's built-in `web_fetch` tool to read the article, then returns
 * one draft per requested platform group. Char limits are passed explicitly
 * in the prompt — the agent does not guess them.
 */
export const getDraftGenerator = async () => {
	const { runner } = await AgentBuilder.create("draft_generator")
		.withDescription(
			"Fetches a blog post and generates platform-group-optimized social media drafts. Returns structured JSON.",
		)
		.withInstruction(
			`You are a social media content specialist. Given a blog post URL, a tone, and a list of target platform GROUPS with their hard character limits:

1. Use the web_fetch tool to read the article. Record its title.
2. For EACH requested group, generate exactly ONE draft. The same draft will be reused verbatim for every platform in that group — write it so it works for all of them.

   Group writing guidelines:
   - **short-casual** (X + Bluesky): Punchy hook, casual voice, 2-3 hashtags. Include the article URL. Must fit the char limit (counting hashtags + URL).
   - **medium-community** (Threads + Mastodon): Conversational, community-friendly. 1-3 hashtags. Include the URL.
   - **long-professional** (LinkedIn): Polished, authoritative, clear takeaway. 3-5 hashtags at the end. Include the URL.

3. The hard character limit for each group is supplied in the prompt. NEVER exceed it. Trim if close — do not guess a higher limit.

4. Apply the requested tone:
   - **auto**: Pick a tone that fits each group (punchy, conversational, professional).
   - **professional / casual / educational / punchy**: Apply uniformly.

5. Return ONLY valid JSON matching the output schema. No markdown fences. The \`article\` block must include the URL and the fetched title. The \`drafts\` array contains one entry per requested group.`,
		)
		.withModel(env.LLM_MODEL)
		.withTools(new WebFetchTool())
		.withOutputSchema(postDraftsSchema)
		.build();

	return runner;
};
