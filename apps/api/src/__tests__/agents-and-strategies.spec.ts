import { describe, it, expect, beforeEach } from 'vitest';
import { AgentSecurityViolationError, AgentToolsService } from '../agents/agent-tools.service';
import { MarketScannerAgent } from '../agents/market-scanner.agent';
import { StrategyAnalystAgent } from '../agents/strategy-analyst.agent';
import { AgentCoordinatorService } from '../agents/agent-coordinator.service';
import { StrategiesService } from '../strategies/strategies.service';
import { ProposalsService } from '../proposals/proposals.service';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { UpstoxMarketFeedService } from '../market-data/upstox-market-feed.service';
import { ProtobufDecoderService } from '../market-data/protobuf-decoder.service';
import { EnvService } from '../config/env.service';
import { EventsGateway } from '../websocket/events.gateway';
import { ProposalStatus, StrategyStatus, TradeMode } from '@trading-bot/contracts';

describe('Agents, Tools & Strategy Engine (Phase 2)', () => {
  let envService: EnvService;
  let decoder: ProtobufDecoderService;
  let gateway: EventsGateway;
  let catalog: InstrumentCatalogService;
  let feed: UpstoxMarketFeedService;
  let agentTools: AgentToolsService;
  let scanner: MarketScannerAgent;
  let analyst: StrategyAnalystAgent;
  let coordinator: AgentCoordinatorService;
  let proposalsService: ProposalsService;
  let strategiesService: StrategiesService;

  beforeEach(() => {
    envService = new EnvService();
    decoder = new ProtobufDecoderService();
    gateway = new EventsGateway();
    catalog = new InstrumentCatalogService();
    catalog.bootstrapCatalog();
    feed = new UpstoxMarketFeedService(envService, decoder, gateway);
    agentTools = new AgentToolsService(catalog, feed);
    scanner = new MarketScannerAgent(agentTools);
    analyst = new StrategyAnalystAgent(agentTools);
    coordinator = new AgentCoordinatorService(scanner, analyst, gateway);
    proposalsService = new ProposalsService(gateway);
    strategiesService = new StrategiesService(coordinator, proposalsService);
  });

  describe('Agent Tool Permissions & Security Boundaries', () => {
    it('STRICT INVARIANT: Agent cannot execute order placement or write tools', async () => {
      // Attempting to execute unauthorized order tool
      await expect(
        agentTools.executeTool('place_order', { symbol: 'NIFTY', quantity: 25 }),
      ).rejects.toThrow(AgentSecurityViolationError);

      await expect(
        agentTools.executeTool('modify_order', { orderId: '123' }),
      ).rejects.toThrow(AgentSecurityViolationError);

      await expect(
        agentTools.executeTool('cancel_order', { orderId: '123' }),
      ).rejects.toThrow(AgentSecurityViolationError);
    });

    it('allows permitted read-only scan_universe tool and returns ranked candidates', async () => {
      const result = await agentTools.executeTool('scan_universe', {
        underlying: 'NIFTY',
        minVolume: 1000,
        maxSpreadPct: 1.0,
      });

      expect(result.underlying).toBe('NIFTY');
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0].spreadPct).toBeLessThanOrEqual(1.0);
      expect(result.candidates[0].liquidityScore).toBeGreaterThan(0);
    });

    it('calculates indicators on closed bars and flags insufficient warm-up when bars are missing', async () => {
      // Test warm-up rejection by clearing candle buffer
      agentTools.setClosedCandles('NSE_INDEX|Nifty 50', []);

      const result = await agentTools.executeTool('calculate_indicators', {
        instrumentKey: 'NSE_INDEX|Nifty 50',
        timeframe: '5m',
        emaPeriod: 20,
        rsiPeriod: 14,
      });

      expect(result.isWarmedUp).toBe(false);
      expect(result.missingWarmupCandles).toBe(20);
    });
  });

  describe('Strategy Management & Immutable Versioning', () => {
    it('retrieves seeded strategy with canonical version hash', () => {
      const strategies = strategiesService.getAllStrategies();
      expect(strategies.length).toBeGreaterThan(0);
      const defaultStrat = strategies[0]!;
      expect(defaultStrat.name).toBe('NIFTY EMA20 RSI Long Call');
      expect(defaultStrat.version).toBe(1);
      expect(defaultStrat.versionHash).toMatch(/^v1-[0-9a-f]{8}$/);
    });

    it('rejects strategy creation exceeding account risk hard caps', () => {
      expect(() =>
        strategiesService.createStrategy({
          name: 'Breach Capital Cap',
          maxCapitalInr: 25000, // Account cap is ₹10,000
          maxAllInTradeLossInr: 500,
          maxAllInDailyLossInr: 1500,
        }),
      ).toThrow();

      expect(() =>
        strategiesService.createStrategy({
          name: 'Breach Trade Loss Cap',
          maxCapitalInr: 10000,
          maxAllInTradeLossInr: 800, // Trade cap is ₹500
          maxAllInDailyLossInr: 1500,
        }),
      ).toThrow();
    });

    it('increments version and updates hash when trading parameters are modified', () => {
      const defaultStrat = strategiesService.getAllStrategies()[0]!;
      const oldHash = defaultStrat.versionHash;

      // Update RSI threshold from 55 to 65 (modifies trading rules)
      const updated = strategiesService.updateStrategy(defaultStrat.id, {
        entry: {
          ...defaultStrat.entry,
          rsiThreshold: 65,
        },
      });

      expect(updated.version).toBe(2);
      expect(updated.versionHash).not.toBe(oldHash);

      // Verify version history preserved
      const history = strategiesService.getVersionHistory(defaultStrat.id);
      expect(history.length).toBe(2);
      expect(history[0]?.version).toBe(1);
    });
  });

  describe('Multi-Agent Workflow Coordination & Proposals', () => {
    it('runs coordinated multi-agent scan, logs task tools, and generates proposal', async () => {
      const defaultStrat = strategiesService.getAllStrategies()[0]!;
      const result = await coordinator.runStrategyWorkflow(defaultStrat);

      expect(result.task).toBeDefined();
      expect(result.task.status).toBe('COMPLETED');
      expect(result.task.toolsInvoked.length).toBeGreaterThanOrEqual(2);
      expect(result.task.toolsInvoked.some((t) => t.tool === 'scan_universe')).toBe(true);

      if (result.proposal) {
        expect(result.proposal.strategyId).toBe(defaultStrat.id);
        expect(result.proposal.lotSize).toBe(25);
        expect(result.proposal.allInMaxLoss).toBeLessThanOrEqual(defaultStrat.maxAllInTradeLossInr);
        expect(result.proposal.estimatedCapitalRequired).toBeLessThanOrEqual(defaultStrat.maxCapitalInr);
        expect(result.proposal.evidence.confidence).toBeGreaterThan(0.6);
      }
    });

    it('handles proposal lifecycle: owner authorization and rejection', () => {
      const pending = proposalsService.getPendingProposals();
      expect(pending.length).toBeGreaterThan(0);
      const proposal = pending[0]!;

      // Approve proposal
      const approved = proposalsService.approveProposal(proposal.id);
      expect(approved.success).toBe(true);
      expect(approved.intentId).toContain('intent_');
      expect(approved.proposal.status).toBe(ProposalStatus.APPROVED);

      // Already approved cannot be re-approved
      expect(() => proposalsService.approveProposal(proposal.id)).toThrow();
    });
  });
});
