/**
 * ABOUTME: Zod schema for Factory Droid agent configuration options.
 * Validates optional model and reasoning effort settings.
 */

import { z } from 'zod';

export const DroidReasoningEffortSchema = z.enum(['low', 'medium', 'high']);

export const DroidAgentConfigSchema = z
  .object({
    model: z.string().optional(),
    reasoningEffort: DroidReasoningEffortSchema.optional(),
    skipPermissions: z.boolean().optional().default(true),
    enableTracing: z.boolean().optional().default(true),
  })
  .passthrough();

export type DroidReasoningEffort = z.infer<typeof DroidReasoningEffortSchema>;
export type DroidAgentConfig = z.infer<typeof DroidAgentConfigSchema>;
