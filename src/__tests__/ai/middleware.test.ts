import { beforeEach, describe, expect, it } from 'vitest';
import { CoordinationSession } from '../../ai/session.js';
import { createCoordinationMiddleware } from '../../ai/middleware.js';

describe('createCoordinationMiddleware', () => {
  let session: CoordinationSession;

  beforeEach(() => {
    session = new CoordinationSession({
      features: ['price_up', 'price_down', 'vol_high', 'momentum', 'EMERGENCY_halt'],
      emergencyPrefix: 'EMERGENCY_',
    });
  });

  it('returns empty middleware when no options enabled', () => {
    const mw = createCoordinationMiddleware(session);
    expect(mw.transformParams).toBeUndefined();
    expect(mw.wrapGenerate).toBeUndefined();
  });

  it('throws when autoEncodeToolCalls is true but agentName is missing', () => {
    expect(() =>
      createCoordinationMiddleware(session, { autoEncodeToolCalls: true }),
    ).toThrow('agentName is required');
  });

  describe('injectConsensus', () => {
    it('prepends a system message with consensus state', async () => {
      session.startRound();
      session.report('agent-1', ['price_up', 'vol_high']);
      session.report('agent-2', ['price_up']);

      const mw = createCoordinationMiddleware(session, { injectConsensus: true });
      expect(mw.transformParams).toBeDefined();

      const params = {
        prompt: [
          { role: 'user' as const, content: [{ type: 'text' as const, text: 'What should we do?' }] },
        ],
      };

      const transformed = await mw.transformParams!({
        params: params as any,
        type: 'generate',
      });

      expect(transformed.prompt.length).toBe(2);
      expect(transformed.prompt[0].role).toBe('system');
      const systemContent = (transformed.prompt[0] as { role: 'system'; content: string }).content;
      expect(systemContent).toContain('[Coordination Consensus]');
      expect(systemContent).toContain('price_up');
    });

    it('shows empty state when no reports', async () => {
      session.startRound();

      const mw = createCoordinationMiddleware(session, { injectConsensus: true });
      const params = {
        prompt: [
          { role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
        ],
      };

      const transformed = await mw.transformParams!({
        params: params as any,
        type: 'generate',
      });

      const systemContent = (transformed.prompt[0] as { role: 'system'; content: string }).content;
      expect(systemContent).toContain('Features: none');
      expect(systemContent).toContain('Emergency: false');
    });
  });

  describe('autoEncodeToolCalls', () => {
    it('reports matching tool call names as observations', async () => {
      session.startRound();

      const mw = createCoordinationMiddleware(session, {
        autoEncodeToolCalls: true,
        agentName: 'auto-agent',
      });
      expect(mw.wrapGenerate).toBeDefined();

      const mockResult = {
        text: 'done',
        toolCalls: [
          { toolName: 'price_up', toolCallId: 'tc1', args: {} },
          { toolName: 'unknown_tool', toolCallId: 'tc2', args: {} },
        ],
      };

      const result = await mw.wrapGenerate!({
        doGenerate: async () => mockResult as any,
        doStream: async () => ({} as any),
        params: { prompt: [] } as any,
        model: {} as any,
      });

      expect(result).toBe(mockResult);
      // price_up should have been auto-reported
      expect(session.coordinator.bufferedCount).toBe(1);
    });

    it('does nothing when no tool calls match features', async () => {
      session.startRound();

      const mw = createCoordinationMiddleware(session, {
        autoEncodeToolCalls: true,
        agentName: 'auto-agent',
      });

      const mockResult = {
        text: 'done',
        toolCalls: [
          { toolName: 'completely_unknown', toolCallId: 'tc1', args: {} },
        ],
      };

      await mw.wrapGenerate!({
        doGenerate: async () => mockResult as any,
        doStream: async () => ({} as any),
        params: { prompt: [] } as any,
        model: {} as any,
      });

      expect(session.coordinator.bufferedCount).toBe(0);
    });

    it('does nothing when no tool calls present', async () => {
      session.startRound();

      const mw = createCoordinationMiddleware(session, {
        autoEncodeToolCalls: true,
        agentName: 'auto-agent',
      });

      const mockResult = { text: 'just text', toolCalls: [] };

      await mw.wrapGenerate!({
        doGenerate: async () => mockResult as any,
        doStream: async () => ({} as any),
        params: { prompt: [] } as any,
        model: {} as any,
      });

      expect(session.coordinator.bufferedCount).toBe(0);
    });
  });

  describe('both options enabled', () => {
    it('creates middleware with both transformParams and wrapGenerate', () => {
      const mw = createCoordinationMiddleware(session, {
        injectConsensus: true,
        autoEncodeToolCalls: true,
        agentName: 'dual-agent',
      });
      expect(mw.transformParams).toBeDefined();
      expect(mw.wrapGenerate).toBeDefined();
    });
  });
});
