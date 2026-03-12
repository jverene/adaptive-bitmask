/**
 * Coordination tools for the Vercel AI SDK.
 *
 * Provides tool definitions that let AI agents report observations,
 * query consensus, and request decisions — all backed by the bitmask protocol.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { decode } from '../index.js';
import type { CoordinationSession } from './session.js';

export function createCoordinationTools(session: CoordinationSession) {
  const reportObservation = tool({
    description:
      'Report observed features to the coordination layer. ' +
      'Each feature string is encoded into the shared bitmask.',
    parameters: z.object({
      agentName: z.string().describe('Name identifying this agent'),
      features: z.array(z.string()).describe('Feature names observed by this agent'),
    }),
    execute: async ({ agentName, features }) => {
      const result = session.report(agentName, features);
      return {
        accepted: result.accepted,
        mapped: result.mapped,
        unmapped: result.unmapped,
      };
    },
  });

  const getConsensus = tool({
    description:
      'Query the current aggregated consensus state across all agents.',
    parameters: z.object({}),
    execute: async () => {
      const { aggregatedFeatures, confidence, result } = session.peek();
      const confidenceObj: Record<string, number> = {};
      for (const [bit, conf] of confidence) {
        confidenceObj[String(bit)] = conf;
      }
      return {
        features: aggregatedFeatures,
        confidence: confidenceObj,
        agentCount: session.coordinator.bufferedCount,
      };
    },
  });

  const requestDecision = tool({
    description:
      'Trigger the arbiter to score the current aggregated state and return a decision.',
    parameters: z.object({}),
    execute: async () => {
      const { decision, aggregatedFeatures, result } = session.decide();
      return {
        decision,
        score: result.finalScore,
        features: aggregatedFeatures,
        hasEmergency: result.hasEmergency,
      };
    },
  });

  return { reportObservation, getConsensus, requestDecision };
}
