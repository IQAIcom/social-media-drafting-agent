import type { BaseTool, ToolContext } from "@iqai/adk";
import { BasePlugin } from "@iqai/adk";

export class WebFetchCachePlugin extends BasePlugin {
  private cache = new Map<string, { result: unknown; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 60 * 60 * 1000) {
    super("web-fetch-cache");
    this.ttlMs = ttlMs;
  }

  private keyFor(args: Record<string, unknown>): string | null {
    const url = args.url;
    return typeof url === "string" ? url : null;
  }

  async beforeToolCallback(params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
  }): Promise<Record<string, unknown> | undefined> {
    if (params.tool.name !== "web_fetch") return undefined;

    const key = this.keyFor(params.toolArgs);
    if (!key) return undefined;

    const hit = this.cache.get(key);
    if (hit && Date.now() < hit.expiresAt) {
      return hit.result as Record<string, unknown>;
    }

    return undefined;
  }

  async afterToolCallback(params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    result: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    if (params.tool.name !== "web_fetch") return undefined;

    const key = this.keyFor(params.toolArgs);
    if (!key) return undefined;

    if ((params.result as { success?: boolean }).success !== false) {
      this.cache.set(key, {
        result: params.result,
        expiresAt: Date.now() + this.ttlMs,
      });
    }

    return undefined;
  }
}
