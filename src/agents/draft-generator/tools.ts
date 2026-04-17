import { createTool } from "@iqai/adk";
import z from "zod";
import { fetchArticle } from "@/lib/article-fetch";

/**
 * Fetches a blog post and returns structured metadata (title, description,
 * author, image, published date) plus the article's plain-text content.
 *
 * The draft generator uses this tool when the server action didn't already
 * pre-fetch and inject the article content into the prompt.
 */
export const fetchBlogPostTool = createTool({
	name: "fetch_blog_post",
	description:
		"Fetches a blog post from a URL and returns structured metadata plus the article's plain text content as JSON. Use this first before generating social media posts.",
	schema: z.object({
		url: z.url().describe("The blog post URL to fetch"),
	}),
	fn: async ({ url }) => {
		const fetched = await fetchArticle(url);
		if (!fetched) {
			return JSON.stringify({
				error: `Failed to fetch or parse URL: ${url}`,
			});
		}
		return JSON.stringify({ ...fetched.article, content: fetched.content });
	},
});
