import {
  BrokerHealth,
  DailyReport,
  Position,
  QuoteSnapshot,
  RiskStatus,
  TradeProposal,
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

  // Positions
  public async getPositions(): Promise<Position[]> {
    return this.request('/positions');
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

  // Reports
  public async getDailyReport(): Promise<DailyReport> {
    return this.request('/reports/daily');
  }
}
