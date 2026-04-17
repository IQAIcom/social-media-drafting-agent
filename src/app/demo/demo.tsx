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
	ALL_PLATFORMS,
	type GroupDraft,
	PLATFORM_GROUPS,
	PLATFORM_LABELS,
	type Platform,
	type PlatformAvailability,
	type PlatformGroup,
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
	{ value: "auto", label: "Auto", description: "Group-appropriate" },
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
	mastodon: Globe,
};

const PLATFORM_COLORS: Record<Platform, string> = {
	linkedin: "text-blue-600 dark:text-blue-400",
	x: "text-foreground",
	bluesky: "text-sky-500",
	threads: "text-foreground",
	mastodon: "text-purple-500",
};

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

const buildCopyAll = (drafts: GroupDraft[]): string =>
	drafts
		.map((d) => {
			const label = PLATFORM_GROUPS[d.group].label;
			const platforms = d.platforms.map((p) => PLATFORM_LABELS[p]).join(", ");
			return `### ${label} — for ${platforms}\n\n${d.content}\n`;
		})
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
	const [platforms, setPlatforms] = useState<Platform[]>([
		"linkedin",
		"x",
		"bluesky",
		"threads",
		"mastodon",
	]);

	// Availability (from server)
	const [availability, setAvailability] = useState<{
		platforms: PlatformAvailability;
	} | null>(null);

	// Generation state
	const [isGenerating, setIsGenerating] = useState(false);
	const [preview, setPreview] = useState<PreviewResult | null>(null);
	const [editableDrafts, setEditableDrafts] = useState<GroupDraft[]>([]);
	const [error, setError] = useState<string | null>(null);

	// Per-draft UI state
	const [regenerating, setRegenerating] = useState<
		Record<PlatformGroup, boolean>
	>({
		"short-casual": false,
		"medium-community": false,
		"long-professional": false,
	});
	const [publishing, setPublishing] = useState<Record<Platform, boolean>>({
		linkedin: false,
		x: false,
		bluesky: false,
		threads: false,
		mastodon: false,
	});
	const [publishResults, setPublishResults] = useState<PublishResult[]>([]);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	// History
	const [history, setHistory] = useState<HistoryEntry[]>([]);

	useEffect(() => {
		getAvailability()
			.then(setAvailability)
			.catch(() => {
				setAvailability({
					platforms: {
						linkedin: false,
						x: false,
						bluesky: false,
						threads: false,
						mastodon: false,
					},
				});
			});
		setHistory(loadHistory());
	}, []);

	useEffect(() => {
		saveHistory(history);
	}, [history]);

	useEffect(() => {
		if (!preview) return;
		const existing = history.find((h) => h.url === preview.article.url);
		const entry: HistoryEntry = {
			id: existing?.id ?? crypto.randomUUID(),
			url: preview.article.url,
			tone,
			platforms,
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
			const result = await previewPosts({ url, tone, platforms });
			setPreview(result);
			setEditableDrafts(result.drafts);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(`Failed to generate drafts: ${message}`);
		} finally {
			setIsGenerating(false);
		}
	};

	const updateDraftContent = (group: PlatformGroup, content: string) => {
		setEditableDrafts((cur) =>
			cur.map((d) =>
				d.group === group ? { ...d, content, charCount: content.length } : d,
			),
		);
	};

	const handleRegenerate = async (draft: GroupDraft) => {
		if (!preview) return;
		setRegenerating((r) => ({ ...r, [draft.group]: true }));
		setError(null);
		try {
			const fresh = await regenerateDraft({
				url: preview.article.url,
				group: draft.group,
				platforms,
				tone,
			});
			setEditableDrafts((cur) =>
				cur.map((d) => (d.group === draft.group ? fresh : d)),
			);
			// The draft has changed — drop any prior publish results for this
			// group's platforms so the user can publish the fresh copy.
			setPublishResults((cur) =>
				cur.filter((r) => !draft.platforms.includes(r.platform)),
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(`Regenerate failed: ${message}`);
		} finally {
			setRegenerating((r) => ({ ...r, [draft.group]: false }));
		}
	};

	const handlePublish = async (platform: Platform, content: string) => {
		setPublishing((p) => ({ ...p, [platform]: true }));
		setError(null);
		try {
			const result = await publishPost({ platform, content });
			setPublishResults((cur) => [
				...cur.filter((r) => r.platform !== platform),
				result,
			]);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setPublishResults((cur) => [
				...cur.filter((r) => r.platform !== platform),
				{ platform, success: false, message: `Failed: ${message}` },
			]);
		} finally {
			setPublishing((p) => ({ ...p, [platform]: false }));
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
		setPreview(entry.preview);
		setEditableDrafts(entry.preview.drafts);
		setPublishResults(entry.publishResults ?? []);
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
							Generate social media drafts
						</CardTitle>
						<CardDescription>
							Paste a blog URL. Review and edit the drafts, then publish
							where you have credentials or copy the rest.
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
								<div className="text-sm font-medium mb-2">Platforms</div>
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
												<Icon
													className={`w-4 h-4 ${PLATFORM_COLORS[p]}`}
												/>
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

				{/* Step 2: Article preview + drafts */}
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
								const spec = PLATFORM_GROUPS[draft.group];
								const over = draft.charCount > draft.charLimit;
								const copyKey = `draft-${draft.group}`;
								return (
									<Card key={draft.group} className="min-w-0">
										<CardHeader>
											<CardTitle className="flex items-center justify-between text-base gap-2">
												<span className="flex items-center gap-2 min-w-0">
													<span className="truncate">{spec.label}</span>
												</span>
												<span
													className={`text-xs font-mono shrink-0 ${
														over
															? "text-destructive"
															: "text-muted-foreground"
													}`}
												>
													{draft.charCount} / {draft.charLimit}
												</span>
											</CardTitle>
											<CardDescription className="flex flex-wrap items-center gap-1.5 mt-1">
												<span className="text-xs">For:</span>
												{draft.platforms.map((p) => {
													const Icon = PLATFORM_ICONS[p];
													return (
														<span
															key={p}
															className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-accent"
														>
															<Icon
																className={`w-3 h-3 ${PLATFORM_COLORS[p]}`}
															/>
															{PLATFORM_LABELS[p]}
														</span>
													);
												})}
											</CardDescription>
										</CardHeader>
										<CardContent className="space-y-3">
											<Textarea
												value={draft.content}
												onChange={(e) =>
													updateDraftContent(draft.group, e.target.value)
												}
												rows={draft.group === "long-professional" ? 10 : 5}
												className="resize-none text-sm"
											/>

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
													onClick={() => handleCopy(copyKey, draft.content)}
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
													disabled={regenerating[draft.group]}
													title="Regenerate just this draft"
												>
													{regenerating[draft.group] ? (
														<Loader2 className="w-4 h-4 animate-spin" />
													) : (
														<RefreshCw className="w-4 h-4" />
													)}
												</Button>
											</div>

											{/* Per-platform publish row. One entry per platform
												 in this group: publishes the SAME draft content to
												 each chosen platform. Falls back to a copy-only
												 hint when credentials aren't set. */}
											<div className="space-y-1.5 pt-1">
												{draft.platforms.map((p) => {
													const Icon = PLATFORM_ICONS[p];
													const publishable =
														availability?.platforms[p] ?? false;
													const result = publishResults.find(
														(r) => r.platform === p,
													);
													if (result) {
														return (
															<div
																key={p}
																className={`flex items-start gap-2 text-xs p-2 rounded-md ${
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
																<span>
																	<strong>{PLATFORM_LABELS[p]}:</strong>{" "}
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
														);
													}
													if (!publishable) {
														return (
															<div
																key={p}
																className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1.5 border border-dashed border-border rounded-md"
															>
																<Icon
																	className={`w-3.5 h-3.5 ${PLATFORM_COLORS[p]}`}
																/>
																<span className="flex-1 truncate">
																	{PLATFORM_LABELS[p]} — no credentials,
																	copy manually
																</span>
															</div>
														);
													}
													return (
														<Button
															key={p}
															onClick={() =>
																handlePublish(p, draft.content)
															}
															disabled={
																publishing[p] ||
																over ||
																!draft.content.trim()
															}
															size="sm"
															variant="outline"
															className="w-full justify-start"
														>
															{publishing[p] ? (
																<Loader2 className="w-4 h-4 animate-spin" />
															) : (
																<>
																	<Icon
																		className={`w-4 h-4 ${PLATFORM_COLORS[p]}`}
																	/>
																	<Send className="w-3.5 h-3.5" />
																	Publish to {PLATFORM_LABELS[p]}
																</>
															)}
														</Button>
													);
												})}
											</div>
										</CardContent>
									</Card>
								);
							})}
						</div>

						<Button
							onClick={clearAll}
							variant="ghost"
							size="sm"
							className="w-full"
						>
							Start over with a new article
						</Button>
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
												<span>{h.preview.drafts.length} drafts</span>
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
