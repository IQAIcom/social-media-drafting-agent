import { createTool } from "@iqai/adk";
import z from "zod";

/**
 * Article metadata extracted from a blog post URL.
 */
export type ArticleMetadata = {
	url: string;
	title: string;
	description: string;
	author: string;
	publishedAt: string;
	image: string;
	siteName: string;
	content: string;
};

/**
 * Extracts a meta tag value from HTML using multiple regex patterns.
 */
const extractMeta = (html: string, patterns: RegExp[]): string => {
	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (match?.[1]) return match[1].trim();
	}
	return "";
};

/**
 * Decodes common HTML entities in a string.
 */
const decodeEntities = (s: string): string =>
	s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");

/**
 * Fetches a blog post and extracts structured metadata (title, description,
 * author, image, published date) plus the article's plain text content.
 *
 * Prefers OpenGraph and Twitter card tags for reliable extraction.
 */
export const fetchBlogPostTool = createTool({
	name: "fetch_blog_post",
	description:
		"Fetches a blog post from a URL and returns structured metadata (title, description, author, image, published date) plus the article's plain text content as JSON. Use this first before generating social media posts.",
	schema: z.object({
		url: z.url().describe("The blog post URL to fetch"),
	}),
	fn: async ({ url }) => {
		try {
			const response = await fetch(url, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (compatible; SocialMediaAgent/1.0; +https://github.com/IQAIcom/adk-ts)",
					Accept: "text/html,application/xhtml+xml,text/plain",
				},
			});

			if (!response.ok) {
				return JSON.stringify({
					error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
				});
			}

			const html = await response.text();

			const title = decodeEntities(
				extractMeta(html, [
					/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
					/<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i,
					/<title[^>]*>([^<]+)<\/title>/i,
				]),
			);

			const description = decodeEntities(
				extractMeta(html, [
					/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i,
					/<meta\s+name=["']twitter:description["']\s+content=["']([^"']+)["']/i,
					/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
				]),
			);

			const author = decodeEntities(
				extractMeta(html, [
					/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i,
					/<meta\s+property=["']article:author["']\s+content=["']([^"']+)["']/i,
					/<meta\s+name=["']twitter:creator["']\s+content=["']([^"']+)["']/i,
				]),
			);

			const publishedAt = extractMeta(html, [
				/<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/i,
				/<meta\s+name=["']pubdate["']\s+content=["']([^"']+)["']/i,
				/<time[^>]*datetime=["']([^"']+)["']/i,
			]);

			const image = extractMeta(html, [
				/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
				/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i,
			]);

			const siteName = decodeEntities(
				extractMeta(html, [
					/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i,
				]),
			);

			// Extract main content: strip scripts, styles, nav, footer, then HTML tags
			const content = html
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
				.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
				.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
				.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim();

			const maxLength = 6000;
			const truncatedContent =
				content.length > maxLength
					? `${content.slice(0, maxLength)}... [truncated]`
					: content;

			const metadata: ArticleMetadata = {
				url,
				title,
				description,
				author,
				publishedAt,
				image,
				siteName,
				content: truncatedContent,
			};

			return JSON.stringify(metadata);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			return JSON.stringify({ error: `Error fetching blog post: ${message}` });
		}
	},
});
