import { Sparkles } from "lucide-react";
import { Navbar } from "./_components/navbar";
import { Demo } from "./demo/demo";

export default function Home() {
	return (
		<>
			<Navbar />
			<div className="min-h-screen bg-background flex flex-col">
				<main className="container mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-20 max-w-6xl">
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
								social drafts
							</span>
						</h1>

						<p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
							Paste a blog URL. The agent reads the article and drafts three posts for LinkedIn, X, Bluesky, Threads, and Mastodon — copy and post manually.
						</p>
					</div>

					<Demo />
				</main>
			</div>
		</>
	);
}
