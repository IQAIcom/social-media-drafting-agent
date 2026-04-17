"use client";

import {
	AlertCircle,
	CheckCircle2,
	ClipboardCheck,
	ClipboardCopy,
	Clock,
	Globe,
	History,
	Linkedin,
	Loader2,
	MessageCircle,
	RefreshCw,
	Send,
	Send as TelegramIcon,
	Sparkles,
	Trash2,
	Twitter,
	Wand2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
	CHAR_LIMITS,
	PLATFORM_LABELS,
	type Platform,
	type PlatformAvailability,
	type PostDraft,
	type PreviewResult,
	type PublishResult,
	type Tone,
} from "@/types";
import {
	getAvailability,
	previewPosts,
	publishPost,
	regenerateDraft,
} from "./_actions";

// ───────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────

const TONES: { value: Tone; label: string; description: string }[] = [
	{ value: "auto", label: "Auto", description: "Platform-appropriate" },
	{ value: "professional", label: "Professional", description: "Polished" },
	{ value: "casual", label: "Casual", description: "Friendly" },
	{ value: "educational", label: "Educational", description: "Explanatory" },
	{ value: "punchy", label: "Punchy", description: "Bold, short" },
];

const PLATFORM_ICONS: Record<Platform, typeof Linkedin> = {
	linkedin: Linkedin,
	x: Twitter,
	bluesky: Globe,
	threads: MessageCircle,
	whatsapp: MessageCircle,
	mastodon: Globe,
	telegram: TelegramIcon,
};

const PLATFORM_COLORS: Record<Platform, string> = {
	linkedin: "text-blue-600 dark:text-blue-400",
	x: "text-foreground",
	bluesky: "text-sky-500",
	threads: "text-foreground",
	whatsapp: "text-green-600 dark:text-green-500",
	mastodon: "text-purple-500",
	telegram: "text-blue-400 dark:text-blue-300",
};

const ALL_PLATFORMS: Platform[] = [
	"linkedin",
	"x",
	"bluesky",
	"threads",
	"whatsapp",
	"mastodon",
	"telegram",
];

// ───────────────────────────────────────────────────────────────────
// Local history (sectionmemory via localStorage)
// ───────────────────────────────────────────────────────────────────

const HISTORY_KEY = "sma:history";
const MAX_HISTORY = 10;

type HistoryEntry = {
	id: string;
	url: string;
	tone: Tone;
	platforms: Platform[];
	xThreadLength: number;
	preview: PreviewResult;
	publishResults: PublishResult[];
	timestamp: number;
};

const loadHistory = (): HistoryEntry[] => {
	if (typeof window === "undefined") return [];
	try {
		const raw = window.localStorage.getItem(HISTORY_KEY);
		return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
	} catch {
		return [];
	}
};

const saveHistory = (items: HistoryEntry[]) => {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
	} catch {
		// ignore quota errors
	}
};

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

const buildCopyText = (draft: PostDraft): string => {
	if (draft.thread && draft.thread.length > 1) {
		return draft.thread
			.map((p, i) => `${i + 1}/${draft.thread?.length}\n${p}`)
			.join("\n\n");
	}
	return draft.content;
};

const buildCopyAll = (drafts: PostDraft[]): string =>
	drafts
		.map(
			(d) =>
				`### ${PLATFORM_LABELS[d.platform]}\n\n${buildCopyText(d)}\n`,
		)
		.join("\n---\n\n");

const timeAgo = (ts: number) => {
	const diff = Date.now() - ts;
	const mins = Math.round(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.round(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.round(hrs / 24)}d ago`;
};

// ───────────────────────────────────────────────────────────────────
// Component
// ───────────────────────────────────────────────────────────────────

export const Demo = () => {
	// Form state
	const [url, setUrl] = useState("");
	const [tone, setTone] = useState<Tone>("auto");
	const [platforms, setPlatforms] = useState<Platform[]>(["linkedin", "x"]);
	const [xThreadLength, setXThreadLength] = useState(1);

	// Availability (from server)
	const [availability, setAvailability] = useState<{
		platforms: PlatformAvailability;
	} | null>(null);

	// Generation state
	const [isGenerating, setIsGenerating] = useState(false);
	const [preview, setPreview] = useState<PreviewResult | null>(null);
	const [editableDrafts, setEditableDrafts] = useState<PostDraft[]>([]);
	const [error, setError] = useState<string | null>(null);

	// Per-draft UI state
	const [regenerating, setRegenerating] = useState<Record<string, boolean>>(
		{},
	);
	const [publishing, setPublishing] = useState<Record<string, boolean>>({});
	const [publishResults, setPublishResults] = useState<PublishResult[]>([]);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	// History
	const [history, setHistory] = useState<HistoryEntry[]>([]);

	// Load availability + history once
	useEffect(() => {
		getAvailability().then(setAvailability).catch(() => {
			// best-effort — if it fails, assume no auto-publish
			setAvailability({
				platforms: {
					linkedin: false,
					x: false,
					bluesky: false,
					threads: false,
					whatsapp: false,
					mastodon: false,
					telegram: false,
				},
			});
		});
		setHistory(loadHistory());
	}, []);

	// Persist history whenever it changes
	useEffect(() => {
		saveHistory(history);
	}, [history]);

	// Save current run into history when we have a preview + drafts
	useEffect(() => {
		if (!preview) return;
		const existing = history.find((h) => h.url === preview.article.url);
		const entry: HistoryEntry = {
			id: existing?.id ?? crypto.randomUUID(),
			url: preview.article.url,
			tone,
			platforms,
			xThreadLength,
			preview,
			publishResults,
			timestamp: Date.now(),
		};
		setHistory((current) => {
			const without = current.filter((h) => h.url !== entry.url);
			return [entry, ...without].slice(0, MAX_HISTORY);
		});
		// biome-ignore lint/correctness/useExhaustiveDependencies: persist on preview/results change
	}, [preview, publishResults]);

	const togglePlatform = (p: Platform) => {
		setPlatforms((cur) =>
			cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
		);
	};

	const resetResults = () => {
		setPreview(null);
		setEditableDrafts([]);
		setPublishResults([]);
		setError(null);
	};

	const handleGenerate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!url.trim() || platforms.length === 0) return;

		resetResults();
		setIsGenerating(true);

		try {
			const result = await previewPosts({
				url,
				tone,
				platforms,
				xThreadLength,
			});
			setPreview(result);
			setEditableDrafts(result.drafts);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(`Failed to generate drafts: ${message}`);
		} finally {
			setIsGenerating(false);
		}
	};

	const updateDraftContent = (platform: Platform, content: string) => {
		setEditableDrafts((cur) =>
			cur.map((d) =>
				d.platform === platform
					? { ...d, content, charCount: content.length, thread: undefined }
					: d,
			),
		);
	};

	const handleRegenerate = async (draft: PostDraft) => {
		if (!preview) return;
		setRegenerating((r) => ({ ...r, [draft.platform]: true }));
		setError(null);
		try {
			const fresh = await regenerateDraft({
				url: preview.article.url,
				platform: draft.platform,
				tone,
				xThreadLength,
			});
			setEditableDrafts((cur) =>
				cur.map((d) => (d.platform === draft.platform ? fresh : d)),
			);
			// Clear publish result for this platform — it's a new draft now
			setPublishResults((cur) =>
				cur.filter((r) => r.platform !== draft.platform),
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(`Regenerate failed: ${message}`);
		} finally {
			setRegenerating((r) => ({ ...r, [draft.platform]: false }));
		}
	};

	const handlePublish = async (draft: PostDraft) => {
		setPublishing((p) => ({ ...p, [draft.platform]: true }));
		setError(null);
		try {
			const result = await publishPost({
				platform: draft.platform,
				content: draft.content,
				thread: draft.thread,
			});
			setPublishResults((cur) => [
				...cur.filter((r) => r.platform !== draft.platform),
				result,
			]);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setPublishResults((cur) => [
				...cur.filter((r) => r.platform !== draft.platform),
				{
					platform: draft.platform,
					success: false,
					message: `Failed: ${message}`,
				},
			]);
		} finally {
			setPublishing((p) => ({ ...p, [draft.platform]: false }));
		}
	};

	const handleCopy = async (key: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedKey(key);
			setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
		} catch {
			setError("Clipboard access denied by browser");
		}
	};

	const loadFromHistory = (entry: HistoryEntry) => {
		setUrl(entry.url);
		setTone(entry.tone);
		setPlatforms(entry.platforms);
		setXThreadLength(entry.xThreadLength);
		setPreview(entry.preview);
		setEditableDrafts(entry.preview.drafts);
		setPublishResults(entry.publishResults);
		setError(null);
	};

	const removeFromHistory = (id: string) => {
		setHistory((cur) => cur.filter((h) => h.id !== id));
	};

	const clearAll = () => {
		setUrl("");
		resetResults();
	};

	return (
		<div className="grid gap-6 lg:grid-cols-[1fr_280px]">
			<div className="space-y-6 min-w-0">
				{/* Step 1: Input form */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-lg">
							<Wand2 className="w-5 h-5 text-primary" />
							Generate social media posts
						</CardTitle>
						<CardDescription>
							Paste a blog URL. Drafts are generated for every selected platform — copy-only where you haven't set up credentials.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleGenerate} className="space-y-4">
							<div>
								<label
									htmlFor="url"
									className="text-sm font-medium mb-2 block"
								>
									Blog post URL
								</label>
								<input
									id="url"
									type="url"
									required
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder="https://your-blog.com/post-slug"
									className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-primary focus:outline-none"
									disabled={isGenerating}
								/>
							</div>

							<div>
								<div className="text-sm font-medium mb-2">Tone</div>
								<div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
									{TONES.map((t) => (
										<button
											key={t.value}
											type="button"
											onClick={() => setTone(t.value)}
											disabled={isGenerating}
											className={`px-2 py-2 rounded-md border text-left text-xs transition-all ${
												tone === t.value
													? "border-primary bg-primary/10 ring-2 ring-primary"
													: "border-border bg-background hover:bg-accent"
											}`}
										>
											<div className="font-medium">{t.label}</div>
											<div className="text-muted-foreground text-[11px] leading-tight">
												{t.description}
											</div>
										</button>
									))}
								</div>
							</div>

							<div>
								<div className="text-sm font-medium mb-2">
									Platforms
								</div>
								<div className="flex gap-2 flex-wrap">
									{ALL_PLATFORMS.map((p) => {
										const Icon = PLATFORM_ICONS[p];
										const active = platforms.includes(p);
										const publishable = availability?.platforms[p];
										return (
											<button
												key={p}
												type="button"
												onClick={() => togglePlatform(p)}
												disabled={isGenerating}
												className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-all ${
													active
														? "border-primary bg-primary/10 ring-2 ring-primary"
														: "border-border bg-background hover:bg-accent"
												}`}
											>
												<Icon className={`w-4 h-4 ${PLATFORM_COLORS[p]}`} />
												{PLATFORM_LABELS[p]}
												{active && !publishable && (
													<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
														copy-only
													</span>
												)}
											</button>
										);
									})}
								</div>
							</div>

							{platforms.includes("x") && (
								<div>
									<div className="text-sm font-medium mb-2">
										X format
									</div>
									<div className="flex items-center gap-3">
										<div className="flex gap-2">
											<button
												type="button"
												onClick={() => setXThreadLength(1)}
												disabled={isGenerating}
												className={`px-3 py-1.5 rounded-md border text-sm ${
													xThreadLength === 1
														? "border-primary bg-primary/10 ring-2 ring-primary"
														: "border-border bg-background hover:bg-accent"
												}`}
											>
												Single post
											</button>
											<button
												type="button"
												onClick={() =>
													setXThreadLength(xThreadLength > 1 ? xThreadLength : 4)
												}
												disabled={isGenerating}
												className={`px-3 py-1.5 rounded-md border text-sm ${
													xThreadLength > 1
														? "border-primary bg-primary/10 ring-2 ring-primary"
														: "border-border bg-background hover:bg-accent"
												}`}
											>
												Thread
											</button>
										</div>
										{xThreadLength > 1 && (
											<div className="flex items-center gap-2 text-sm">
												<label htmlFor="thread-length" className="text-muted-foreground">
													Posts:
												</label>
												<input
													id="thread-length"
													type="number"
													min={2}
													max={10}
													value={xThreadLength}
													onChange={(e) =>
														setXThreadLength(
															Math.min(
																10,
																Math.max(2, Number(e.target.value) || 4),
															),
														)
													}
													className="w-16 px-2 py-1 rounded-md border border-border bg-background text-sm"
													disabled={isGenerating}
												/>
											</div>
										)}
									</div>
								</div>
							)}

							<Button
								type="submit"
								size="lg"
								className="w-full"
								disabled={
									isGenerating || !url.trim() || platforms.length === 0
								}
							>
								{isGenerating ? (
									<>
										<Loader2 className="w-4 h-4 animate-spin" />
										Reading article & generating drafts...
									</>
								) : (
									<>
										<Sparkles className="w-4 h-4" />
										Generate drafts
									</>
								)}
							</Button>

							{error && (
								<div className="flex items-start gap-2 text-sm text-destructive p-3 rounded-md border border-destructive/30 bg-destructive/5">
									<AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
									<span>{error}</span>
								</div>
							)}
						</form>
					</CardContent>
				</Card>

				{/* Step 2: Article preview */}
				{preview && (
					<>
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center justify-between text-base">
									<span>Article</span>
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											handleCopy("all", buildCopyAll(editableDrafts))
										}
									>
										{copiedKey === "all" ? (
											<>
												<ClipboardCheck className="w-4 h-4" />
												Copied all
											</>
										) : (
											<>
												<ClipboardCopy className="w-4 h-4" />
												Copy all drafts
											</>
										)}
									</Button>
								</CardTitle>
							</CardHeader>
							<CardContent className="flex gap-4 items-start">
								{preview.article.image && (
									<img
										src={preview.article.image}
										alt=""
										className="w-24 h-24 object-cover rounded-md border border-border shrink-0"
									/>
								)}
								<div className="min-w-0 flex-1">
									<h3 className="font-semibold text-sm leading-snug mb-1">
										{preview.article.title || "Untitled"}
									</h3>
									{preview.article.description && (
										<p className="text-xs text-muted-foreground line-clamp-2 mb-2">
											{preview.article.description}
										</p>
									)}
									<div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
										{preview.article.siteName && (
											<span>{preview.article.siteName}</span>
										)}
										{preview.article.author && (
											<span>by {preview.article.author}</span>
										)}
									</div>
								</div>
							</CardContent>
						</Card>

						<div className="grid gap-4 md:grid-cols-2">
							{editableDrafts.map((draft) => {
								const Icon = PLATFORM_ICONS[draft.platform];
								const publishable =
									availability?.platforms[draft.platform] ?? false;
								const isThread =
									draft.platform === "x" &&
									draft.thread &&
									draft.thread.length > 1;
								const over = draft.charCount > draft.charLimit;
								const result = publishResults.find(
									(r) => r.platform === draft.platform,
								);
								const copyKey = `draft-${draft.platform}`;
								return (
									<Card key={draft.platform} className="min-w-0">
										<CardHeader>
											<CardTitle className="flex items-center justify-between text-base gap-2">
												<span className="flex items-center gap-2 min-w-0">
													<Icon
														className={`w-4 h-4 shrink-0 ${PLATFORM_COLORS[draft.platform]}`}
													/>
													<span className="truncate">
														{PLATFORM_LABELS[draft.platform]}
														{isThread &&
															` · Thread (${draft.thread?.length})`}
													</span>
												</span>
												<span
													className={`text-xs font-mono shrink-0 ${
														over ? "text-destructive" : "text-muted-foreground"
													}`}
												>
													{draft.charCount} / {CHAR_LIMITS[draft.platform]}
												</span>
											</CardTitle>
										</CardHeader>
										<CardContent className="space-y-3">
											{isThread ? (
												<div className="space-y-2">
													{draft.thread?.map((post, i) => (
														<div
															// biome-ignore lint/suspicious/noArrayIndexKey: stable order
															key={i}
															className="rounded-md border border-border bg-muted/30 p-2"
														>
															<div className="text-[10px] text-muted-foreground mb-1">
																{i + 1} / {draft.thread?.length}
															</div>
															<div className="text-sm whitespace-pre-wrap">
																{post}
															</div>
															<div className="text-[10px] text-muted-foreground text-right mt-1 font-mono">
																{post.length} / 280
															</div>
														</div>
													))}
												</div>
											) : (
												<Textarea
													value={draft.content}
													onChange={(e) =>
														updateDraftContent(
															draft.platform,
															e.target.value,
														)
													}
													rows={draft.platform === "linkedin" ? 10 : 5}
													className="resize-none text-sm"
													disabled={
														publishing[draft.platform] || result?.success
													}
												/>
											)}

											{draft.hashtags.length > 0 && (
												<div className="flex flex-wrap gap-1">
													{draft.hashtags.map((h) => (
														<span
															key={h}
															className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground"
														>
															#{h.replace(/^#/, "")}
														</span>
													))}
												</div>
											)}

											<div className="flex gap-2">
												<Button
													onClick={() =>
														handleCopy(copyKey, buildCopyText(draft))
													}
													variant="outline"
													size="sm"
													className="flex-1"
												>
													{copiedKey === copyKey ? (
														<>
															<ClipboardCheck className="w-4 h-4" />
															Copied
														</>
													) : (
														<>
															<ClipboardCopy className="w-4 h-4" />
															Copy
														</>
													)}
												</Button>

												<Button
													onClick={() => handleRegenerate(draft)}
													variant="outline"
													size="sm"
													disabled={regenerating[draft.platform]}
													title="Regenerate just this draft"
												>
													{regenerating[draft.platform] ? (
														<Loader2 className="w-4 h-4 animate-spin" />
													) : (
														<RefreshCw className="w-4 h-4" />
													)}
												</Button>
											</div>

											{publishable ? (
												result ? (
													<div
														className={`flex items-start gap-2 text-sm p-2 rounded-md ${
															result.success
																? "bg-green-500/10 text-green-700 dark:text-green-400"
																: "bg-destructive/10 text-destructive"
														}`}
													>
														{result.success ? (
															<CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
														) : (
															<AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
														)}
														<span className="text-xs">
															{result.message}
															{result.url && (
																<>
																	{" "}
																	<a
																		href={result.url}
																		target="_blank"
																		rel="noopener noreferrer"
																		className="underline"
																	>
																		View post
																	</a>
																</>
															)}
														</span>
													</div>
												) : (
													<Button
														onClick={() => handlePublish(draft)}
														disabled={
															publishing[draft.platform] ||
															over ||
															!draft.content.trim()
														}
														size="sm"
														className="w-full"
													>
														{publishing[draft.platform] ? (
															<>
																<Loader2 className="w-4 h-4 animate-spin" />
																Publishing...
															</>
														) : (
															<>
																<Send className="w-4 h-4" />
																Publish to {PLATFORM_LABELS[draft.platform]}
															</>
														)}
													</Button>
												)
											) : (
												<div className="text-xs text-muted-foreground text-center py-1 border border-dashed border-border rounded-md">
													No credentials — use Copy to post manually
												</div>
											)}
										</CardContent>
									</Card>
								);
							})}
						</div>

						{preview && (
							<Button
								onClick={clearAll}
								variant="ghost"
								size="sm"
								className="w-full"
							>
								Start over with a new article
							</Button>
						)}
					</>
				)}
			</div>

			{/* Sidebar: recent articles */}
			<aside className="lg:sticky lg:top-20 self-start">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-sm">
							<History className="w-4 h-4" />
							Recent articles
						</CardTitle>
						<CardDescription className="text-xs">
							Stored locally in your browser.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{history.length === 0 ? (
							<p className="text-xs text-muted-foreground">
								Your recently processed articles will appear here.
							</p>
						) : (
							<ul className="space-y-2">
								{history.map((h) => (
									<li
										key={h.id}
										className="group rounded-md border border-border p-2 hover:bg-accent/50 transition-colors"
									>
										<button
											type="button"
											onClick={() => loadFromHistory(h)}
											className="w-full text-left"
										>
											<div className="text-xs font-medium line-clamp-2 mb-1">
												{h.preview.article.title || h.url}
											</div>
											<div className="flex items-center gap-2 text-[10px] text-muted-foreground">
												<Clock className="w-3 h-3" />
												{timeAgo(h.timestamp)}
												<span>·</span>
												<span>{h.platforms.length} platforms</span>
											</div>
										</button>
										<button
											type="button"
											onClick={() => removeFromHistory(h.id)}
											className="mt-1 text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
										>
											<Trash2 className="w-3 h-3" />
											Remove
										</button>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
			</aside>
		</div>
	);
};
