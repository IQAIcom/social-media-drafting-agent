import { getDraftGenerator } from "../draft-generator/agent";

/**
 * Runner for generating post drafts from a blog post URL.
 * Output is strongly typed via the draft generator's output schema.
 */
export const getDraftRunner = async () => {
	return await getDraftGenerator();
};
