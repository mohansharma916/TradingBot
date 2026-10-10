// Unit tests must never inherit the owner's credentials or live configuration from .env.
// Individual tests can still explicitly supply/stub configuration to exercise live gates.
Object.assign(process.env, {
  NODE_ENV: 'test',
  OWNER_USERNAME: 'owner',
  OWNER_PASSWORD: 'isolated-unit-test-owner-password',
  JWT_SECRET: 'isolated-unit-test-signature-secret-123456789',
  TOKEN_ENCRYPTION_KEY: 'isolated-unit-test-encryption-secret-123456789',
  STATE_DIRECTORY: '.data',
  SYSTEM_MODE: 'PAPER',
  DEFAULT_RISK_STATE: 'DISARMED',
  LIVE_EXECUTION_ENABLED: 'false',
  MFA_ENABLED: 'false',
  MAX_ACCOUNT_CAPITAL_INR: '10000',
  MAX_ALL_IN_TRADE_RISK_INR: '500',
  MAX_DAILY_DRAWDOWN_INR: '1500',
  TARGET_DAILY_PROFIT_INR: '4000',
  UPSTOX_API_KEY: 'mock_key',
  UPSTOX_API_SECRET: 'mock_secret',
  UPSTOX_REDIRECT_URI: 'http://localhost:4000/api/v1/broker/upstox/callback',
  UPSTOX_EGRESS_IP: '127.0.0.1',
  UPSTOX_BASE_URL: 'https://api.upstox.com/v3',
  UPSTOX_HFT_URL: 'https://api-hft.upstox.com/v3',
  UPSTOX_ALGO_NAME: '',
  CORS_ORIGIN: 'http://localhost:8081,http://localhost:3000',
});
delete process.env.DAILY_BOT_STORAGE_PATH;
delete process.env.LIVE_EXECUTION_LEDGER_PATH;
delete process.env.STRATEGIES_STORAGE_PATH;
