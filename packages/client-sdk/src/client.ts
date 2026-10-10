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
} from '@trading-bot/contracts';

export interface ClientConfig {
  baseUrl: string;
  authToken?: string;
  fetchFn?: typeof fetch;
}

export class TradingPlatformClient {
  private baseUrl: string;
  private authToken?: string;
  private fetch: typeof fetch;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.fetch = config.fetchFn || fetch;
  }

  public setToken(token: string) {
    this.authToken = token;
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

  // Agents
  public async getAgentTasks(): Promise<AgentTask[]> {
    return this.request('/agents/tasks');
  }

  public async getAgentTools(): Promise<any> {
    return this.request('/agents/tools');
  }

  // Reports
  public async getDailyReport(): Promise<DailyReport> {
    return this.request('/reports/daily');
  }
}
