import { Sparkles } from "lucide-react";

export const Hero = () => {
	return (
		<div className="text-center mb-10">
			<div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-accent border border-border mb-6">
				<Sparkles className="w-4 h-4 text-primary" />
				<span className="text-xs sm:text-sm font-medium text-muted-foreground">
					Powered by ADK-TS
				</span>
			</div>
			<h1 className="text-4xl sm:text-5xl font-bold mb-4 tracking-tight leading-tight">
				Turn blog posts into{" "}
				<span className="bg-linear-to-r from-primary to-pink-400 bg-clip-text text-transparent">
					social posts
				</span>
			</h1>

			<p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
				Paste a blog URL. The agent reads the article and drafts posts for
				LinkedIn, X, Bluesky, Threads, and Mastodon — ready to copy and share.
			</p>
		</div>
	);
};
