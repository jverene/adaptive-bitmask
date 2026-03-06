import { beforeEach, describe, expect, it } from 'vitest';
import { CoordinationSession } from '../../ai/session.js';
import { createCoordinationTools } from '../../ai/tools.js';

describe('createCoordinationTools', () => {
  let session: CoordinationSession;
  let tools: ReturnType<typeof createCoordinationTools>;

  beforeEach(() => {
    session = new CoordinationSession({
      features: ['price_up', 'price_down', 'vol_high', 'momentum', 'EMERGENCY_halt'],
      emergencyPrefix: 'EMERGENCY_',
    });
    tools = createCoordinationTools(session);
  });

  it('returns three tool definitions', () => {
    expect(tools.reportObservation).toBeDefined();
    expect(tools.getConsensus).toBeDefined();
    expect(tools.requestDecision).toBeDefined();
  });

  describe('reportObservation', () => {
    it('reports features and returns mapped count', async () => {
      session.startRound();
      const result = await tools.reportObservation.execute(
        { agentName: 'trader-1', features: ['price_up', 'momentum'] },
        { toolCallId: 'tc1', messages: [] },
      );
      expect(result.accepted).toBe(true);
      expect(result.mapped).toBe(2);
      expect(result.unmapped).toBe(0);
    });

    it('tracks unmapped features', async () => {
      session.startRound();
      const result = await tools.reportObservation.execute(
        { agentName: 'trader-1', features: ['price_up', 'nonexistent'] },
        { toolCallId: 'tc1', messages: [] },
      );
      expect(result.mapped).toBe(1);
      expect(result.unmapped).toBe(1);
    });
  });

  describe('getConsensus', () => {
    it('returns aggregated features and confidence', async () => {
      session.startRound();
      session.report('agent-1', ['price_up', 'vol_high']);
      session.report('agent-2', ['price_up', 'momentum']);

      const result = await tools.getConsensus.execute(
        {},
        { toolCallId: 'tc2', messages: [] },
      );
      expect(result.features).toContain('price_up');
      expect(result.agentCount).toBe(2);
      expect(typeof result.confidence).toBe('object');
    });

    it('returns empty state when no reports', async () => {
      session.startRound();
      const result = await tools.getConsensus.execute(
        {},
        { toolCallId: 'tc2', messages: [] },
      );
      expect(result.features).toEqual([]);
      expect(result.agentCount).toBe(0);
    });
  });

  describe('requestDecision', () => {
    it('returns a decision with score and features', async () => {
      session.startRound();
      session.report('agent-1', ['price_up', 'vol_high', 'momentum']);
      session.report('agent-2', ['price_up', 'vol_high']);

      const result = await tools.requestDecision.execute(
        {},
        { toolCallId: 'tc3', messages: [] },
      );
      expect(['EXECUTE', 'SYNTHESIZE', 'REJECT']).toContain(result.decision);
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.features)).toBe(true);
      expect(typeof result.hasEmergency).toBe('boolean');
    });

    it('detects emergency', async () => {
      session.startRound();
      session.report('agent-1', ['EMERGENCY_halt', 'price_up']);

      const result = await tools.requestDecision.execute(
        {},
        { toolCallId: 'tc3', messages: [] },
      );
      expect(result.hasEmergency).toBe(true);
    });
  });
});
