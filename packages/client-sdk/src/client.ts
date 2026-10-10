import {
  BrokerHealth,
  DailyReport,
  Position,
  QuoteSnapshot,
  RiskStatus,
  TradeProposal,
  Instrument,
  OptionChainResult,
  MarketCalendar,
  StrategyConfig,
  AgentTask,
  BrokerOrder,
  OrderFillEvent,
  UpstoxOAuthConnectResponse,
  UpstoxSessionStatus,
  ReconciliationReport,
  GoLiveChecklist,
  GoLiveChecklistItem,
  SupervisedExecutionRequest,
  SupervisedExecutionResult,
  FlattenPositionsResult,
  SystemAlert,
  DiagnosticsReport,
  ReconciliationScheduleStatus,
  AlertSeverity,
  AutonomousReadinessReport,
  AutonomousArmRequest,
  AutonomousSessionStatus,
  AutonomousExecutionLog,
  DailyBotConfigInput,
  DailyBotControlAction,
  DailyBotPreflight,
  DailyBotSession,
  DailyBotSetup,
  DailyBotStartRequest,
  DailyBotToday,
  BacktestRequest,
  BacktestResult,
  StrategyAstConfig,
  TradingModeSnapshot,
  TradeMode,
} from '@trading-bot/contracts';

export interface ClientConfig {
  baseUrl: string;
  authToken?: string;
  fetchFn?: typeof fetch;
}

export class TradingPlatformClient {
  private baseUrl: string;
  private authToken?: string;
  private fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    const customFetch = config.fetchFn;
    this.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (customFetch) {
        return customFetch(input, init);
      }
      if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        return window.fetch(input, init);
      }
      if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
        return globalThis.fetch(input, init);
      }
      return fetch(input, init);
    };
  }

  public setToken(token: string) {
    this.authToken = token;
  }

  public setAuthToken(token?: string) { this.authToken = token; }

  public async login(username: string, password: string): Promise<{ token: string; expiresAt: string }> {
    const result = await this.request<{ token: string; expiresAt: string }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    });
    this.setAuthToken(result.token);
    return result;
  }

  public async logout(): Promise<void> {
    try { await this.request('/auth/logout', { method: 'POST' }); }
    finally { this.setAuthToken(undefined); }
  }

  public getTradingMode(): Promise<TradingModeSnapshot> { return this.request('/trading/mode'); }

  public selectTradingMode(mode: TradeMode.PAPER | TradeMode.APPROVAL): Promise<TradingModeSnapshot> {
    return this.request('/trading/mode', { method: 'POST', body: JSON.stringify({ mode }) });
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await this.fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`API error ${response.status} on ${endpoint}: ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  // Health
  public async getLiveHealth(): Promise<{ status: string; uptime: number }> {
    return this.request('/health/live');
  }

  public async getReadyHealth(): Promise<{ status: string; checks: Record<string, boolean> }> {
    return this.request('/health/ready');
  }

  // Me / Session
  public async getMe(): Promise<{ id: string; role: string; email: string }> {
    return this.request('/me');
  }

  // Broker
  public async getBrokerHealth(): Promise<BrokerHealth> {
    return this.request('/broker/health');
  }

  public async getBrokerFunds(): Promise<any> {
    return this.request('/broker/funds');
  }

  public async getUpstoxSession(): Promise<UpstoxSessionStatus> {
    return this.request('/broker/upstox/session');
  }

  public async connectUpstox(): Promise<UpstoxOAuthConnectResponse> {
    return this.request('/broker/upstox/connect', {
      method: 'POST',
    });
  }

  public async exchangeUpstoxCallback(
    code: string,
    state: string,
  ): Promise<{ success: boolean; session: UpstoxSessionStatus }> {
    return this.request('/broker/upstox/callback', {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    });
  }

  public async disconnectUpstox(): Promise<{ success: boolean; message: string }> {
    return this.request('/broker/upstox/disconnect', {
      method: 'POST',
    });
  }

  public async getReconciliationReport(): Promise<ReconciliationReport> {
    return this.request('/broker/reconciliation-status');
  }

  public async triggerReconciliation(): Promise<ReconciliationReport> {
    return this.request('/broker/reconcile', {
      method: 'POST',
    });
  }

  // Risk
  public async getRiskStatus(): Promise<RiskStatus> {
    return this.request('/risk/status');
  }

  public async armRisk(durationMinutes: number): Promise<RiskStatus> {
    return this.request('/risk/arm', {
      method: 'POST',
      body: JSON.stringify({ durationMinutes }),
    });
  }

  public async disarmRisk(): Promise<RiskStatus> {
    return this.request('/risk/disarm', {
      method: 'POST',
    });
  }

  public async emergencyStop(): Promise<{ success: boolean; message: string }> {
    return this.request('/risk/emergency-stop', {
      method: 'POST',
    });
  }

  public async resetKillSwitch(): Promise<RiskStatus> {
    return this.request('/risk/reset-kill-switch', {
      method: 'POST',
    });
  }

  public async flattenPositions(): Promise<FlattenPositionsResult> {
    return this.request('/risk/flatten-request', {
      method: 'POST',
    });
  }

  // Markets
  public async getWatchlist(): Promise<QuoteSnapshot[]> {
    return this.request('/markets/watchlist');
  }

  public async getOptionChain(underlying = 'NIFTY', expiry?: string): Promise<OptionChainResult> {
    const params = new URLSearchParams({ underlying });
    if (expiry) params.set('expiry', expiry);
    return this.request(`/markets/options-chain?${params.toString()}`);
  }

  public async getMarketCalendar(): Promise<MarketCalendar> {
    return this.request('/markets/calendar');
  }

  public async getFeedHealth(): Promise<any> {
    return this.request('/markets/feed-health');
  }

  public async subscribeInstruments(keys: string[]): Promise<{ success: boolean }> {
    return this.request('/markets/subscribe', {
      method: 'POST',
      body: JSON.stringify({ instrumentKeys: keys }),
    });
  }

  public async unsubscribeInstruments(keys: string[]): Promise<{ success: boolean }> {
    return this.request('/markets/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ instrumentKeys: keys }),
    });
  }

  // Instruments
  public async searchInstruments(query: string, underlying?: string, instrumentType?: string): Promise<Instrument[]> {
    const params = new URLSearchParams({ query });
    if (underlying) params.set('underlying', underlying);
    if (instrumentType) params.set('instrumentType', instrumentType);
    return this.request(`/instruments/search?${params.toString()}`);
  }

  public async getInstrument(key: string): Promise<Instrument> {
    return this.request(`/instruments/${encodeURIComponent(key)}`);
  }

  // Orders & Positions
  public async getOrders(): Promise<BrokerOrder[]> {
    return this.request('/orders');
  }

  public async getPositions(): Promise<Position[]> {
    return this.request('/positions');
  }

  public async getOrderFills(): Promise<OrderFillEvent[]> {
    return this.request('/orders/fills');
  }

  public async executeProposal(
    proposalId: string,
    simulatedPartialFill?: boolean,
  ): Promise<{ orderId: string; status: string; message: string }> {
    return this.request('/orders/execute-proposal', {
      method: 'POST',
      body: JSON.stringify({ proposalId, simulatedPartialFill }),
    });
  }

  public async closePosition(key: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/positions/${encodeURIComponent(key)}/close`, {
      method: 'POST',
    });
  }

  // Supervised Live Execution & Protective GTT Exits
  public async executeSupervisedProposal(
    req: SupervisedExecutionRequest,
  ): Promise<SupervisedExecutionResult> {
    return this.request('/orders/supervised-execute', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  public async getGoLiveChecklist(): Promise<GoLiveChecklist> {
    return this.request('/orders/go-live-checklist');
  }

  public async signOffGoLiveChecklist(signedOffBy?: string): Promise<GoLiveChecklist> {
    return this.request('/orders/go-live-checklist/sign-off', {
      method: 'POST',
      body: JSON.stringify({ signedOffBy }),
    });
  }

  public async signOffChecklistItem(id: string, evidence?: string): Promise<GoLiveChecklistItem> {
    return this.request('/orders/go-live-checklist/sign-off-item', {
      method: 'POST',
      body: JSON.stringify({ id, evidence }),
    });
  }

  // Trade Proposals
  public async getPendingProposals(): Promise<TradeProposal[]> {
    return this.request('/trade-proposals');
  }

  public async approveProposal(id: string): Promise<{ success: boolean; intentId: string }> {
    return this.request(`/trade-proposals/${id}/approve`, {
      method: 'POST',
    });
  }

  public async rejectProposal(id: string, reason: string): Promise<{ success: boolean }> {
    return this.request(`/trade-proposals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Strategies
  public async getStrategies(): Promise<StrategyConfig[]> {
    return this.request('/strategies');
  }

  public async getStrategy(id: string): Promise<StrategyConfig> {
    return this.request(`/strategies/${id}`);
  }

  public async getStrategyVersions(id: string): Promise<StrategyConfig[]> {
    return this.request(`/strategies/${id}/versions`);
  }

  public async createStrategy(dto: any): Promise<StrategyConfig> {
    return this.request('/strategies', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }

  public async updateStrategy(id: string, dto: any): Promise<StrategyConfig> {
    return this.request(`/strategies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
  }

  public async runStrategyScan(id: string): Promise<any> {
    return this.request(`/strategies/${id}/scan`, {
      method: 'POST',
    });
  }

  public async getStrategyTemplates(): Promise<any[]> {
    return this.request('/strategies/templates');
  }

  public async validateStrategyRules(astConfig: StrategyAstConfig): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
    return this.request('/strategies/validate', {
      method: 'POST',
      body: JSON.stringify(astConfig),
    });
  }

  public async createStrategyFromTemplate(templateId: string, overrides?: any): Promise<StrategyConfig> {
    return this.request(`/strategies/from-template/${templateId}`, {
      method: 'POST',
      body: JSON.stringify(overrides ?? {}),
    });
  }

  public async duplicateStrategy(id: string): Promise<StrategyConfig> {
    return this.request(`/strategies/${id}/duplicate`, {
      method: 'POST',
    });
  }

  public async archiveStrategy(id: string): Promise<StrategyConfig> {
    return this.request(`/strategies/${id}/archive`, {
      method: 'POST',
    });
  }

  public async runBacktest(strategyId: string, options?: Partial<BacktestRequest>): Promise<BacktestResult> {
    return this.request(`/strategies/${strategyId}/backtest`, {
      method: 'POST',
      body: JSON.stringify(options ?? {}),
    });
  }

  // Daily Trading Bot
  public async getDailyBotToday(): Promise<DailyBotToday> {
    return this.request('/daily-bot/today');
  }

  public async getDailyBotSetups(): Promise<DailyBotSetup[]> {
    return this.request('/daily-bot/setups');
  }

  public async createDailyBotSetup(config: DailyBotConfigInput): Promise<DailyBotSetup> {
    return this.request('/daily-bot/setups', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  public async cloneDailyBotSetup(id: string, tradingDate: string): Promise<DailyBotSetup> {
    return this.request(`/daily-bot/setups/${encodeURIComponent(id)}/clone`, {
      method: 'POST',
      body: JSON.stringify({ tradingDate }),
    });
  }

  public async preflightDailyBot(id: string): Promise<DailyBotPreflight> {
    return this.request(`/daily-bot/setups/${encodeURIComponent(id)}/preflight`, {
      method: 'POST',
    });
  }

  public async startDailyBot(id: string, request: DailyBotStartRequest): Promise<DailyBotSession> {
    return this.request(`/daily-bot/setups/${encodeURIComponent(id)}/start`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  public async getDailyBotSession(id: string): Promise<DailyBotSession> {
    return this.request(`/daily-bot/sessions/${encodeURIComponent(id)}`);
  }

  public async controlDailyBot(id: string, action: DailyBotControlAction): Promise<DailyBotSession> {
    return this.request(`/daily-bot/sessions/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
    });
  }

  // Agents
  public async getAgentTasks(): Promise<AgentTask[]> {
    return this.request('/agents/tasks');
  }

  public async getAgentTools(): Promise<any> {
    return this.request('/agents/tools');
  }

  // Reports & CSV Export
  public async getDailyReport(): Promise<DailyReport> {
    return this.request('/reports/daily');
  }

  public async exportDailyReportCsv(): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    const res = await this.fetch(`${this.baseUrl}/reports/daily/export-csv`, {
      headers,
    });
    if (!res.ok) throw new Error(`API error ${res.status} on report export`);
    return res.text();
  }

  // Health & Diagnostics
  public async getDiagnostics(): Promise<DiagnosticsReport> {
    return this.request('/health/diagnostics');
  }

  // Alerts & Notifications
  public async getAlerts(limit = 50): Promise<SystemAlert[]> {
    return this.request(`/alerts?limit=${limit}`);
  }

  public async acknowledgeAlert(id: string): Promise<SystemAlert> {
    return this.request(`/alerts/${id}/acknowledge`, {
      method: 'POST',
    });
  }

  public async triggerDrillAlert(params?: {
    severity?: AlertSeverity;
    category?: any;
    title?: string;
    message?: string;
  }): Promise<SystemAlert> {
    return this.request('/alerts/test', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  // Reconciliation Schedule
  public async getReconciliationSchedule(): Promise<ReconciliationScheduleStatus> {
    return this.request('/broker/reconciliation/schedule');
  }

  public async getReconciliationHistory(): Promise<ReconciliationReport[]> {
    return this.request('/broker/reconciliation/history');
  }

  public async startReconciliationSchedule(
    intervalSeconds = 60,
  ): Promise<ReconciliationScheduleStatus> {
    return this.request('/broker/reconciliation/schedule/start', {
      method: 'POST',
      body: JSON.stringify({ intervalSeconds }),
    });
  }

  public async stopReconciliationSchedule(): Promise<ReconciliationScheduleStatus> {
    return this.request('/broker/reconciliation/schedule/stop', {
      method: 'POST',
    });
  }

  // Phase 7: Bounded Autonomous Mode
  public async getAutonomousReadiness(): Promise<AutonomousReadinessReport> {
    return this.request('/autonomous/readiness');
  }

  public async getAutonomousStatus(): Promise<AutonomousSessionStatus> {
    return this.request('/autonomous/status');
  }

  public async armAutonomous(req: AutonomousArmRequest): Promise<AutonomousSessionStatus> {
    return this.request('/autonomous/arm', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  public async disarmAutonomous(
    reason = 'Operator Manual Disarm',
  ): Promise<AutonomousSessionStatus> {
    return this.request('/autonomous/disarm', {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  public async executeAutonomousProposal(
    proposalId: string,
  ): Promise<SupervisedExecutionResult> {
    return this.request(`/autonomous/execute/${proposalId}`, {
      method: 'POST',
    });
  }

  public async getAutonomousLogs(): Promise<AutonomousExecutionLog[]> {
    return this.request('/autonomous/logs');
  }
}
