"use client";

import {
	AlertCircle,
	ClipboardCheck,
	ClipboardCopy,
	Clock,
	History,
	Linkedin,
	Loader2,
	MessageCircle,
	RefreshCw,
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
	PLATFORM_LABELS,
	PLATFORM_SPECS,
	type Platform,
	type PlatformDraft,
	type PostFormat,
	type PreviewResult,
	THREAD_LENGTH_DEFAULT,
	THREAD_LENGTH_MAX,
	THREAD_LENGTH_MIN,
	THREADABLE_PLATFORMS,
	type Tone,
} from "@/types";
import { previewPosts, regenerateDraft } from "@/app/actions";

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
	threads: MessageCircle,
};

const PLATFORM_COLORS: Record<Platform, string> = {
	linkedin: "text-blue-600 dark:text-blue-400",
	x: "text-foreground",
	threads: "text-foreground",
};

// ───────────────────────────────────────────────────────────────────
// Local history (localStorage)
// ───────────────────────────────────────────────────────────────────

const HISTORY_KEY = "sma:history";
const MAX_HISTORY = 10;

type HistoryEntry = {
	id: string;
	url: string;
	tone: Tone;
	platforms: Platform[];
	format: PostFormat;
	threadLength: number;
	preview: PreviewResult;
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

const withUrl = (content: string, url: string): string => {
	if (!url || content.includes(url)) return content;
	return `${content}\n\n${url}`;
};

const buildDraftCopy = (draft: PlatformDraft, url: string): string => {
	if (draft.segments && draft.segments.length > 1) {
		const n = draft.segments.length;
		return draft.segments
			.map((s, i) => `(${i + 1}/${n})\n${s}`)
			.join("\n\n---\n\n");
	}
	return withUrl(draft.content, url);
};

const buildCopyAll = (drafts: PlatformDraft[], url: string): string =>
	drafts
		.map((d) => {
			const label = PLATFORM_LABELS[d.platform];
			return `### ${label}\n\n${buildDraftCopy(d, url)}\n`;
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

export const Drafter = () => {
	// Form state
	const [url, setUrl] = useState("");
	const [tone, setTone] = useState<Tone>("auto");
	const [platforms, setPlatforms] = useState<Platform[]>([
		"linkedin",
		"x",
		"threads",
	]);
	const [format, setFormat] = useState<PostFormat>("post");
	const [threadLength, setThreadLength] = useState<number>(
		THREAD_LENGTH_DEFAULT,
	);

	// Generation state
	const [isGenerating, setIsGenerating] = useState(false);
	const [preview, setPreview] = useState<PreviewResult | null>(null);
	const [editableDrafts, setEditableDrafts] = useState<PlatformDraft[]>([]);
	const [error, setError] = useState<string | null>(null);

	// Per-draft UI state
	const [regenerating, setRegenerating] = useState<Record<Platform, boolean>>({
		linkedin: false,
		x: false,
		threads: false,
	});
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	// History
	const [history, setHistory] = useState<HistoryEntry[]>([]);

	useEffect(() => {
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
			format,
			threadLength,
			preview,
			timestamp: Date.now(),
		};
		setHistory((current) => {
			const without = current.filter((h) => h.url !== entry.url);
			return [entry, ...without].slice(0, MAX_HISTORY);
		});
		// biome-ignore lint/correctness/useExhaustiveDependencies: persist on preview change
	}, [preview]);

	const togglePlatform = (p: Platform) => {
		setPlatforms((cur) =>
			cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
		);
	};

	const resetResults = () => {
		setPreview(null);
		setEditableDrafts([]);
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
				format,
				threadLength,
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
					? { ...d, content, charCount: content.length }
					: d,
			),
		);
	};

	const updateThreadSegment = (
		platform: Platform,
		index: number,
		value: string,
	) => {
		setEditableDrafts((cur) =>
			cur.map((d) => {
				if (d.platform !== platform || !d.segments) return d;
				const segments = d.segments.map((s, i) => (i === index ? value : s));
				const content = segments.join("\n\n");
				const charCount = segments.reduce(
					(m, s) => Math.max(m, s.length),
					0,
				);
				return { ...d, segments, content, charCount };
			}),
		);
	};

	const handleRegenerate = async (draft: PlatformDraft) => {
		if (!preview) return;
		setRegenerating((r) => ({ ...r, [draft.platform]: true }));
		setError(null);
		try {
			const fresh = await regenerateDraft({
				url: preview.article.url,
				platform: draft.platform,
				tone,
				format,
				threadLength,
			});
			setEditableDrafts((cur) =>
				cur.map((d) => (d.platform === draft.platform ? fresh : d)),
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(`Regenerate failed: ${message}`);
		} finally {
			setRegenerating((r) => ({ ...r, [draft.platform]: false }));
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
		setFormat(entry.format ?? "post");
		setThreadLength(entry.threadLength ?? THREAD_LENGTH_DEFAULT);
		setPreview(entry.preview);
		setEditableDrafts(entry.preview.drafts);
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
							Paste a blog URL. Review and edit the drafts, then copy and
							post them manually.
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
											</button>
										);
									})}
								</div>

								{platforms.some((p) =>
									THREADABLE_PLATFORMS.includes(p),
								) && (
									<div className="mt-3 space-y-2">
										<div className="flex items-center gap-2 flex-wrap">
											<span className="text-xs text-muted-foreground">
												Format for{" "}
												{platforms
													.filter((p) => THREADABLE_PLATFORMS.includes(p))
													.map((p) => PLATFORM_LABELS[p])
													.join(" & ")}
												:
											</span>
											{(["post", "thread"] as PostFormat[]).map((f) => (
												<button
													key={f}
													type="button"
													onClick={() => setFormat(f)}
													disabled={isGenerating}
													className={`px-3 py-1 rounded-md border text-xs transition-all ${
														format === f
															? "border-primary bg-primary/10 ring-2 ring-primary"
															: "border-border bg-background hover:bg-accent"
													}`}
												>
													{f === "post" ? "Single post" : "Thread"}
												</button>
											))}
										</div>

										{format === "thread" && (
											<div className="flex items-center gap-2 flex-wrap">
												<span className="text-xs text-muted-foreground">
													Thread length:
												</span>
												<div className="inline-flex items-center gap-1">
													<button
														type="button"
														onClick={() =>
															setThreadLength((n) =>
																Math.max(THREAD_LENGTH_MIN, n - 1),
															)
														}
														disabled={
															isGenerating || threadLength <= THREAD_LENGTH_MIN
														}
														className="w-7 h-7 rounded-md border border-border bg-background hover:bg-accent text-sm disabled:opacity-50"
														aria-label="Decrease thread length"
													>
														−
													</button>
													<span className="min-w-[2ch] text-center text-xs font-mono tabular-nums">
														{threadLength}
													</span>
													<button
														type="button"
														onClick={() =>
															setThreadLength((n) =>
																Math.min(THREAD_LENGTH_MAX, n + 1),
															)
														}
														disabled={
															isGenerating || threadLength >= THREAD_LENGTH_MAX
														}
														className="w-7 h-7 rounded-md border border-border bg-background hover:bg-accent text-sm disabled:opacity-50"
														aria-label="Increase thread length"
													>
														+
													</button>
												</div>
												<span className="text-[11px] text-muted-foreground">
													posts ({THREAD_LENGTH_MIN}–{THREAD_LENGTH_MAX})
												</span>
											</div>
										)}
									</div>
								)}
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

				{/* Step 2: Drafts */}
				{preview && (
					<>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="text-xs text-muted-foreground mb-0.5">
									Drafts for
								</div>
								<h3 className="font-semibold text-sm leading-snug truncate">
									{preview.article.title || preview.article.url}
								</h3>
							</div>
							<Button
								variant="ghost"
								size="sm"
								onClick={() =>
									handleCopy(
										"all",
										buildCopyAll(editableDrafts, preview.article.url),
									)
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
						</div>

						<div className="grid gap-4 md:grid-cols-2">
							{editableDrafts.map((draft) => {
								const spec = PLATFORM_SPECS[draft.platform];
								const Icon = PLATFORM_ICONS[draft.platform];
								const over = draft.charCount > draft.charLimit;
								const copyKey = `draft-${draft.platform}`;
								return (
									<Card key={draft.platform} className="min-w-0">
										<CardHeader>
											<CardTitle className="flex items-center justify-between text-base gap-2">
												<span className="flex items-center gap-2 min-w-0">
													<Icon
														className={`w-4 h-4 shrink-0 ${PLATFORM_COLORS[draft.platform]}`}
													/>
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
											<CardDescription className="text-xs mt-1">
												{spec.description}
											</CardDescription>
										</CardHeader>
										<CardContent className="space-y-3">
											{draft.segments && draft.segments.length > 1 ? (
												<div className="space-y-2">
													{draft.segments.map((segment, i) => {
														const segOver = segment.length > draft.charLimit;
														return (
															<div
																key={`${draft.platform}-seg-${i}`}
																className="space-y-1"
															>
																<div className="flex items-center justify-between text-[11px]">
																	<span className="text-muted-foreground font-mono">
																		{i + 1}/{draft.segments?.length}
																	</span>
																	<span
																		className={`font-mono ${
																			segOver
																				? "text-destructive"
																				: "text-muted-foreground"
																		}`}
																	>
																		{segment.length} / {draft.charLimit}
																	</span>
																</div>
																<Textarea
																	value={segment}
																	onChange={(e) =>
																		updateThreadSegment(
																			draft.platform,
																			i,
																			e.target.value,
																		)
																	}
																	rows={3}
																	className="resize-none text-sm"
																/>
															</div>
														);
													})}
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
														handleCopy(
															copyKey,
															buildDraftCopy(draft, preview.article.url),
														)
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
