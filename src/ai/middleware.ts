/**
 * Coordination middleware for the Vercel AI SDK.
 *
 * Optionally injects consensus state into the system prompt and/or
 * auto-encodes tool call names as bitmask observations.
 */

import type { LanguageModelV1Middleware } from 'ai';
import { decode, hasEmergency } from '../index.js';
import type { CoordinationSession } from './session.js';

export interface CoordinationMiddlewareOptions {
  /** Inject current consensus into system prompt before each LLM call. Default: false. */
  injectConsensus?: boolean;
  /**
   * Auto-encode tool call names as bitmask observations after generation. Default: false.
   * When enabled, tool calls whose names match registered schema features are
   * automatically reported to the coordinator. Requires agentName.
   */
  autoEncodeToolCalls?: boolean;
  /** Required when autoEncodeToolCalls is true. Identifies this agent in the coordinator. */
  agentName?: string;
}

export function createCoordinationMiddleware(
  session: CoordinationSession,
  options: CoordinationMiddlewareOptions = {},
): LanguageModelV1Middleware {
  const { injectConsensus = false, autoEncodeToolCalls = false, agentName } = options;

  if (autoEncodeToolCalls && !agentName) {
    throw new Error('agentName is required when autoEncodeToolCalls is enabled');
  }

  const middleware: LanguageModelV1Middleware = {};

  if (injectConsensus) {
    middleware.transformParams = async ({ params }) => {
      const { aggregatedMask, confidence } = session.coordinator.aggregate();
      const features = decode(aggregatedMask, session.schema.bitToFeatures);
      const emergency = hasEmergency(aggregatedMask);

      const confidenceEntries = Array.from(confidence.entries())
        .map(([bit, conf]) => `  bit ${bit}: ${(conf * 100).toFixed(0)}%`)
        .join('\n');

      const consensusText = [
        '[Coordination Consensus]',
        `Features: ${features.length > 0 ? features.join(', ') : 'none'}`,
        `Emergency: ${emergency}`,
        confidenceEntries ? `Confidence:\n${confidenceEntries}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        ...params,
        prompt: [
          { role: 'system' as const, content: consensusText },
          ...params.prompt,
        ],
      };
    };
  }

  if (autoEncodeToolCalls) {
    middleware.wrapGenerate = async ({ doGenerate }) => {
      const result = await doGenerate();

      if (result.toolCalls && result.toolCalls.length > 0) {
        const matchingFeatures = result.toolCalls
          .map((tc: { toolName: string }) => tc.toolName)
          .filter((name: string) => session.schema.featureToBit.has(name));

        if (matchingFeatures.length > 0) {
          session.report(agentName!, matchingFeatures);
        }
      }

      return result;
    };
  }

  return middleware;
}
