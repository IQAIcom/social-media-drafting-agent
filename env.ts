import { config } from "dotenv";
import { z } from "zod";

config();

/**
 * Environment variable schema.
 *
 * Only GOOGLE_API_KEY is required — it powers the draft generator LLM.
 * Publishing is intentionally out of scope for this project.
 */
export const envSchema = z.object({
	ADK_DEBUG: z.coerce.boolean().default(false),
	GOOGLE_API_KEY: z.string().min(1, "GOOGLE_API_KEY is required"),
	LLM_MODEL: z.string().default("gemini-2.5-flash"),
});

export const env = envSchema.parse(process.env);
