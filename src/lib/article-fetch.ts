import "server-only";
import type { ArticlePreview } from "@/types";

/**
 * Shared blog-post fetching + parsing.
 *
 * Used by both the agent's `fetch_blog_post` tool and the server action
 * that warms the cache — they were previously duplicated.
 */

export type FetchedArticle = {
	article: ArticlePreview;
	content: string;
};

const USER_AGENT =
	"Mozilla/5.0 (compatible; SocialMediaAgent/1.0; +https://github.com/IQAIcom/adk-ts)";
const MAX_CONTENT_LENGTH = 6000;

const extractMeta = (html: string, patterns: RegExp[]): string => {
	for (const pattern of patterns) {
		const match = html.match(pattern);
		if (match?.[1]) return match[1].trim();
	}
	return "";
};

const decodeEntities = (s: string): string =>
	s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");

const parseArticleHtml = (url: string, html: string): FetchedArticle => {
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

	const bodyText = html
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
		.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
		.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	const content =
		bodyText.length > MAX_CONTENT_LENGTH
			? `${bodyText.slice(0, MAX_CONTENT_LENGTH)}... [truncated]`
			: bodyText;

	return {
		article: {
			url,
			title,
			description,
			author,
			publishedAt,
			image,
			siteName,
		},
		content,
	};
};

/**
 * Fetch a URL and extract structured article metadata + plain-text content.
 * Returns null if the fetch fails.
 */
export const fetchArticle = async (
	url: string,
): Promise<FetchedArticle | null> => {
	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "text/html,application/xhtml+xml,text/plain",
			},
		});
		if (!response.ok) return null;
		const html = await response.text();
		return parseArticleHtml(url, html);
	} catch {
		return null;
	}
};
