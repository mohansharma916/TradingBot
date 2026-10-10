import { describe, it, expect, beforeEach } from 'vitest';
import { EnvService } from '../config/env.service';
import { TokenStorageService } from '../broker/token-storage.service';
import { UpstoxOAuthService } from '../broker/upstox-oauth.service';
import { UpstoxBrokerAdapter } from '../broker/upstox-broker.adapter';
import { BrokerReconciliationService } from '../broker/broker-reconciliation.service';
import { PaperBrokerAdapter } from '../broker/paper-broker.adapter';
import { RiskReservationManager } from '../risk/risk-reservation.manager';
import { InstrumentCatalogService } from '../instruments/instrument-catalog.service';
import { EventsGateway } from '../websocket/events.gateway';
import {
  OrderStatus,
  OrderSide,
  OrderType,
  ProductType,
  Position,
  BrokerOrder,
  UpstoxSessionStatusSchema,
  ReconciliationReportSchema,
} from '@trading-bot/contracts';

describe('Phase 4: Upstox OAuth, Token Encryption & Broker Reconciliation', () => {
  let envService: EnvService;
  let tokenStorage: TokenStorageService;
  let oauthService: UpstoxOAuthService;
  let upstoxBroker: UpstoxBrokerAdapter;
  let paperBroker: PaperBrokerAdapter;
  let catalogService: InstrumentCatalogService;
  let reservationManager: RiskReservationManager;
  let reconciliationService: BrokerReconciliationService;
  let gateway: EventsGateway;
  let mockFeed: any;

  beforeEach(() => {
    envService = new EnvService();
    tokenStorage = new TokenStorageService(envService);
    gateway = new EventsGateway();
    oauthService = new UpstoxOAuthService(envService, tokenStorage, gateway);
    catalogService = new InstrumentCatalogService();
    upstoxBroker = new UpstoxBrokerAdapter(envService, catalogService, tokenStorage);

    mockFeed = {
      getQuote: (_key: string) => ({
        instrumentKey: _key,
        lastPrice: 122.5,
        bidPrice: 122.4,
        askPrice: 122.6,
        isStale: false,
        timestamp: new Date().toISOString(),
      }),
      getFeedHealth: () => ({ staleCount: 0, feedLatencyMs: 15 }),
    };

    paperBroker = new PaperBrokerAdapter(catalogService, mockFeed, gateway);
    reservationManager = new RiskReservationManager(envService);
    reconciliationService = new BrokerReconciliationService(
      paperBroker,
      upstoxBroker,
      reservationManager,
      oauthService,
      gateway,
    );
  });

  describe('1. AES-256-GCM Token Encryption & Storage', () => {
    it('encrypts token payload, stores IV and auth tag, and decrypts accurately', () => {
      const record = tokenStorage.storeToken({
        accessToken: 'live_upstox_token_secret_12345',
        refreshToken: 'refresh_token_67890',
        expiresInSeconds: 3600,
        userId: 'USER_101',
        userType: 'individual',
      });

      expect(record.cipherText).toBeDefined();
      expect(record.iv).toBeDefined();
      expect(record.authTag).toBeDefined();
      expect(record.cipherText).not.toContain('live_upstox_token_secret_12345');

      const decrypted = tokenStorage.getToken();
      expect(decrypted).not.toBeNull();
      expect(decrypted!.accessToken).toBe('live_upstox_token_secret_12345');
      expect(decrypted!.userId).toBe('USER_101');
      expect(tokenStorage.hasValidToken()).toBe(true);
    });

    it('rejects tampered cipher text with integrity error', () => {
      tokenStorage.storeToken({
        accessToken: 'sensitive_token',
        expiresInSeconds: 3600,
        userId: 'USER_101',
        userType: 'individual',
      });

      // Tamper ciphertext in record
      (tokenStorage as any).currentRecord.cipherText = 'bad_cipher_deadbeef';
      expect(() => tokenStorage.getToken()).toThrow(/decryption failed/i);
    });

    it('redacts secrets in logs helper', () => {
      const redacted = TokenStorageService.redactSecret('super_secret_access_token_long_string');
      expect(redacted).toBe('supe...ring');
      expect(redacted).not.toContain('access_token');
    });
  });

  describe('2. Upstox OAuth 2.0 Authorization & Code Exchange', () => {
    it('generates secure authorization URL with 16-byte random CSRF state', () => {
      const auth = oauthService.generateAuthorizationUrl();
      expect(auth.authUrl).toContain('https://api.upstox.com/v2/login/authorization/dialog');
      expect(auth.authUrl).toContain(`state=${auth.state}`);
      expect(auth.state.length).toBeGreaterThanOrEqual(16);
      expect(auth.expiresInSeconds).toBe(600);
    });

    it('rejects code exchange if CSRF state is invalid or missing', async () => {
      await expect(
        oauthService.exchangeAuthorizationCode('sample_code', 'invalid_unknown_state'),
      ).rejects.toThrow(/invalid, missing, or expired oauth csrf state/i);
    });

    it('exchanges code, encrypts token, updates session status, and cleans up state', async () => {
      const { state } = oauthService.generateAuthorizationUrl();
      const result = await oauthService.exchangeAuthorizationCode('mock_code_123', state);

      expect(result.success).toBe(true);
      expect(result.session.isConnected).toBe(true);
      expect(result.session.egressIpVerified).toBe(true);
      expect(tokenStorage.hasValidToken()).toBe(true);

      // Replay attack prevention: state must be consumed
      await expect(
        oauthService.exchangeAuthorizationCode('mock_code_123', state),
      ).rejects.toThrow(/invalid, missing, or expired oauth csrf state/i);
    });

    it('clears encrypted token and broadcasts disconnect on logout', async () => {
      const { state } = oauthService.generateAuthorizationUrl();
      await oauthService.exchangeAuthorizationCode('mock_code_123', state);
      expect(tokenStorage.hasValidToken()).toBe(true);

      const res = oauthService.disconnect();
      expect(res.success).toBe(true);
      expect(tokenStorage.hasValidToken()).toBe(false);
      expect(oauthService.getSessionStatus().isConnected).toBe(false);
    });
  });

  describe('3. Upstox Read-Only Adapter & Live Write Safety Invariants', () => {
    it('returns degraded health if unauthenticated, healthy when token is stored', async () => {
      tokenStorage.clearToken();
      const healthBefore = await upstoxBroker.getConnectionHealth();
      expect(healthBefore.isAuthenticated).toBe(false);
      expect(healthBefore.status).toBe('DEGRADED');

      tokenStorage.storeToken({
        accessToken: 'test_token',
        expiresInSeconds: 3600,
        userId: 'USER_101',
        userType: 'individual',
      });

      const healthAfter = await upstoxBroker.getConnectionHealth();
      expect(healthAfter.isAuthenticated).toBe(true);
      expect(healthAfter.status).toBe('HEALTHY');
      expect(healthAfter.registeredEgressIp).toBe('127.0.0.1');
    });

    it('strictly throws on live order write routes (placeOrder, modifyOrder, cancelOrder)', async () => {
      await expect(
        upstoxBroker.placeOrder({
          instrumentKey: 'NSE_FO|NIFTY_25100_CE',
          side: OrderSide.BUY,
          quantity: 25,
        }),
      ).rejects.toThrow(/live order execution is strictly blocked in phase 4/i);

      await expect(
        upstoxBroker.modifyOrder({ orderId: 'ord_1', price: 125 }),
      ).rejects.toThrow(/live order modification is strictly blocked in phase 4/i);

      await expect(upstoxBroker.cancelOrder('ord_1')).rejects.toThrow(
        /live order cancellation is strictly blocked in phase 4/i,
      );
    });
  });

  describe('4. Broker Startup & Continuous Reconciliation Engine', () => {
    it('returns CLEAN report when local ledger and broker positions match exactly', async () => {
      const localPositions = await paperBroker.getPositions();
      // Mirror local positions into broker to simulate exact match
      const report = await reconciliationService.runReconciliation({
        mockBrokerPositions: localPositions,
        mockBrokerOrders: [],
      });

      expect(report.status).toBe('CLEAN');
      expect(report.executionFrozen).toBe(false);
      expect(report.discrepancies.length).toBe(0);
      expect(ReconciliationReportSchema.safeParse(report).success).toBe(true);
    });

    it('detects external phantom broker position, flags CRITICAL, and freezes execution via Kill Switch', async () => {
      const localPositions = await paperBroker.getPositions();

      const phantomPosition: Position = {
        id: '550e8400-e29b-41d4-a716-446655440099',
        instrumentKey: 'NSE_FO|BANKNIFTY_2026-10-15_52500_PE',
        symbol: 'BANKNIFTY 52500 PE',
        netQuantity: 15,
        buyQuantity: 15,
        sellQuantity: 0,
        buyAvgPrice: 165.2,
        sellAvgPrice: 0,
        lastPrice: 168.0,
        unrealizedPnl: 42.0,
        realizedPnl: 0,
        stopLossPrice: null,
        targetPrice: null,
        lastVerifiedAt: new Date().toISOString(),
      };

      const report = await reconciliationService.runReconciliation({
        mockBrokerPositions: [...localPositions, phantomPosition],
        mockBrokerOrders: [],
      });

      expect(report.status).toBe('MISMATCH_DETECTED');
      expect(report.executionFrozen).toBe(true);
      expect(report.discrepancies.length).toBe(1);
      expect(report.discrepancies[0].type).toBe('PHANTOM_BROKER_POSITION');
      expect(report.discrepancies[0].severity).toBe('CRITICAL');

      // Invariant: Kill switch must be activated to prevent any further entry submissions
      expect(reservationManager.isKillSwitchActive()).toBe(true);
    });

    it('detects position quantity divergence between broker and app', async () => {
      await paperBroker.placeOrder({ intentId: 'position_divergence_entry', tag: 'TEST', instrumentKey: 'NSE_FO|NIFTY_2026-10-15_25100_CE', side: OrderSide.BUY, orderType: OrderType.MARKET, product: ProductType.I, quantity: 25 });
      const localPositions = await paperBroker.getPositions();
      const basePos = localPositions[0];

      // Inject mismatch broker position with quantity 50 instead of 25
      const mismatchedBrokerPosition: Position = {
        ...basePos,
        netQuantity: 50, // Mismatch!
      };

      const report = await reconciliationService.runReconciliation({
        mockBrokerPositions: [mismatchedBrokerPosition],
        mockBrokerOrders: [],
      });

      expect(report.status).toBe('MISMATCH_DETECTED');
      expect(report.executionFrozen).toBe(true);
      const posMismatch = report.discrepancies.find((d) => d.type === 'POSITION_MISMATCH');
      expect(posMismatch).toBeDefined();
      expect(posMismatch!.brokerValue).toBe(50);
      expect(posMismatch!.localValue).toBe(25);
    });
  });

  describe('5. Schema Contract Validation', () => {
    it('validates UpstoxSessionStatusSchema contract', () => {
      const session = {
        isConnected: true,
        isExpired: false,
        tokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
        secondsRemaining: 86400,
        egressIpVerified: true,
        registeredEgressIp: '127.0.0.1',
        currentEgressIp: '127.0.0.1',
        rateLimitRemaining: 25,
        lastReconciledAt: new Date().toISOString(),
      };

      const parsed = UpstoxSessionStatusSchema.parse(session);
      expect(parsed.isConnected).toBe(true);
      expect(parsed.egressIpVerified).toBe(true);
    });
  });
});
