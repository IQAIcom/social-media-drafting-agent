import { AgentBuilder } from "@iqai/adk";
import { env } from "../../../env";
import { getDraftGenerator } from "../draft-generator/agent";
import { getPublisherAgent } from "../publisher/agent";

/**
 * Runner for generating post drafts from a blog post URL.
 * Output is strongly typed via the draft generator's output schema.
 */
export const getDraftRunner = async () => {
	return await getDraftGenerator();
};

/**
 * Runner for publishing a single post to any supported platform.
 * Wraps the publisher agent in a coordinator that delegates to it.
 */
export const getPublishRunner = async () => {
	const agent = await getPublisherAgent();

	const { runner } = await AgentBuilder.create("publish_coordinator")
		.withDescription("Publishes a social media post to the chosen platform.")
		.withInstruction(
			"Delegate publishing requests to the publisher_agent. Return its JSON response verbatim.",
		)
		.withModel(env.LLM_MODEL)
		.withSubAgents([agent])
		.build();

	return runner;
};
