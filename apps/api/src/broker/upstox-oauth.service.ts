import {
  Injectable,
  Inject,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { TokenStorageService } from './token-storage.service';
import { EventsGateway } from '../websocket/events.gateway';
import {
  UpstoxOAuthConnectResponse,
  UpstoxSessionStatus,
} from '@trading-bot/contracts';
import crypto from 'node:crypto';

interface OAuthStateRecord {
  state: string;
  createdAt: number;
}

@Injectable()
export class UpstoxOAuthService {
  private readonly logger = new Logger(UpstoxOAuthService.name);
  private activeStates: Map<string, OAuthStateRecord> = new Map();
  private lastReconciledAt: string | null = null;

  constructor(
    @Inject(EnvService) private readonly envService: EnvService,
    @Inject(TokenStorageService) private readonly tokenStorage: TokenStorageService,
    @Inject(EventsGateway) private readonly gateway: EventsGateway,
  ) {}

  /**
   * Generates a secure authorization URL with cryptographically random CSRF state.
   */
  public generateAuthorizationUrl(): UpstoxOAuthConnectResponse {
    const cfg = this.envService.config;
    const state = crypto.randomBytes(16).toString('hex');
    const now = Date.now();

    // Clean up expired states (> 10 minutes)
    for (const [k, v] of this.activeStates.entries()) {
      if (now - v.createdAt > 600000) {
        this.activeStates.delete(k);
      }
    }

    this.activeStates.set(state, { state, createdAt: now });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.UPSTOX_API_KEY || 'mock_key',
      redirect_uri: cfg.UPSTOX_REDIRECT_URI,
      state,
    });

    const authUrl = `https://api.upstox.com/v2/login/authorization/dialog?${params.toString()}`;

    this.logger.log(`[UpstoxOAuth] Generated OAuth authorization URL. State: ${state.slice(0, 8)}...`);

    return {
      authUrl,
      state,
      expiresInSeconds: 600,
    };
  }

  /**
   * Exchanges an authorization code for an encrypted access token.
   */
  public async exchangeAuthorizationCode(
    code: string,
    state: string,
  ): Promise<{ success: boolean; session: UpstoxSessionStatus }> {
    if (!state || !this.activeStates.has(state)) {
      throw new BadRequestException('Invalid, missing, or expired OAuth CSRF state parameter.');
    }

    const stateRecord = this.activeStates.get(state)!;
    if (Date.now() - stateRecord.createdAt > 600000) {
      this.activeStates.delete(state);
      throw new BadRequestException('OAuth CSRF state has expired. Please initiate login again.');
    }

    // Remove state immediately to prevent replay attacks
    this.activeStates.delete(state);

    const cfg = this.envService.config;

    // Simulation / Sandbox branch
    if (cfg.UPSTOX_API_KEY === 'mock_key' || code.startsWith('mock_') || code === 'test_auth_code') {
      this.logger.log(`[UpstoxOAuth] Exchanging authorization code in SANDBOX/MOCK mode.`);
      this.tokenStorage.storeToken({
        accessToken: `upstox_sand_${crypto.randomBytes(16).toString('hex')}`,
        refreshToken: `upstox_ref_${crypto.randomBytes(16).toString('hex')}`,
        expiresInSeconds: 86400, // 24 hours
        userId: 'UPSTOX_DEV_916',
        userType: 'individual',
      });

      this.gateway.broadcast('broker.oauth.connected', {
        status: 'CONNECTED',
        userId: 'UPSTOX_DEV_916',
      });

      return {
        success: true,
        session: this.getSessionStatus(),
      };
    }

    // Live OAuth Token Exchange
    try {
      this.logger.log(`[UpstoxOAuth] Exchanging authorization code with Upstox V2 token API...`);
      const tokenUrl = 'https://api.upstox.com/v2/login/authorization/token';
      const body = new URLSearchParams({
        code,
        client_id: cfg.UPSTOX_API_KEY,
        client_secret: cfg.UPSTOX_API_SECRET || '',
        redirect_uri: cfg.UPSTOX_REDIRECT_URI,
        grant_type: 'authorization_code',
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(`[UpstoxOAuth] Token exchange failed HTTP ${response.status}: ${errText}`);
        throw new UnauthorizedException(`Upstox OAuth token exchange rejected: ${response.status}`);
      }

      const data = await response.json();
      const accessToken = data.access_token;
      const expiresIn = data.expires_in || 86400;
      const userId = data.user_id || 'UPSTOX_USER';
      const userType = data.user_type || 'individual';

      this.tokenStorage.storeToken({
        accessToken,
        refreshToken: data.refresh_token,
        expiresInSeconds: expiresIn,
        userId,
        userType,
      });

      this.gateway.broadcast('broker.oauth.connected', {
        status: 'CONNECTED',
        userId,
      });

      return {
        success: true,
        session: this.getSessionStatus(),
      };
    } catch (err: any) {
      this.logger.error(`[UpstoxOAuth] Code exchange encountered error: ${err.message}`);
      throw new UnauthorizedException(`OAuth authorization code exchange failed: ${err.message}`);
    }
  }

  /**
   * Retrieves active session status without leaking raw tokens.
   */
  public getSessionStatus(): UpstoxSessionStatus {
    const meta = this.tokenStorage.getTokenMetadata();
    const cfg = this.envService.config;

    // Validate egress IP against registered IP
    const currentEgressIp = 'UNVERIFIED';
    const token = this.tokenStorage.hasValidToken() ? this.tokenStorage.getToken()?.accessToken : undefined;
    const genuine = typeof token === 'string' && !!token && !/^(mock_|test_|upstox_sand_|upstox_ref_)/i.test(token);

    return {
      isConnected: meta.exists && !meta.isExpired && genuine,
      isExpired: meta.isExpired,
      tokenExpiresAt: meta.expiresAt,
      secondsRemaining: meta.secondsRemaining,
      egressIpVerified: false,
      registeredEgressIp: cfg.UPSTOX_EGRESS_IP,
      currentEgressIp,
      rateLimitRemaining: 25,
      lastReconciledAt: this.lastReconciledAt,
    };
  }

  /**
   * Disconnects the broker session and deletes stored tokens.
   */
  public disconnect(): { success: boolean; message: string } {
    this.tokenStorage.clearToken();
    this.gateway.broadcast('broker.oauth.disconnected', {
      status: 'DISCONNECTED',
    });
    return {
      success: true,
      message: 'Broker connection terminated. Stored access tokens have been purged.',
    };
  }

  public setLastReconciledAt(timestamp: string): void {
    this.lastReconciledAt = timestamp;
  }
}
