-- Initial Schema for AI-Assisted F&O Trading Platform
-- Reference: Blueprint Section 11 Data model (PostgreSQL)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    login_subject VARCHAR(255) NOT NULL UNIQUE,
    mfa_enabled BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Broker Connections (Upstox)
CREATE TABLE IF NOT EXISTS broker_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    broker VARCHAR(50) NOT NULL DEFAULT 'UPSTOX',
    encrypted_token_ref TEXT,
    expires_at TIMESTAMPTZ,
    health VARCHAR(50) DEFAULT 'HEALTHY',
    static_ip VARCHAR(45) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Accounts
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    broker_connection_id UUID REFERENCES broker_connections(id) ON DELETE SET NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    balance_snapshot NUMERIC(15, 2) DEFAULT 10000.00,
    mode VARCHAR(20) DEFAULT 'PAPER',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Risk Policies
CREATE TABLE IF NOT EXISTS risk_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    effective_version INT DEFAULT 1,
    max_capital NUMERIC(15, 2) DEFAULT 10000.00,
    trade_risk NUMERIC(15, 2) DEFAULT 500.00,
    daily_loss NUMERIC(15, 2) DEFAULT 1500.00,
    open_count INT DEFAULT 1,
    armed_until TIMESTAMPTZ,
    kill_switch_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Strategies & Strategy Versions
CREATE TABLE IF NOT EXISTS strategies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    mode VARCHAR(20) DEFAULT 'PAPER',
    status VARCHAR(50) DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    version INT NOT NULL,
    config_json JSONB NOT NULL,
    config_hash VARCHAR(64) NOT NULL,
    status VARCHAR(50) DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Tasks
CREATE TABLE IF NOT EXISTS agent_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_type VARCHAR(50) NOT NULL,
    requested_by UUID NOT NULL REFERENCES users(id),
    objective TEXT NOT NULL,
    state VARCHAR(50) DEFAULT 'PENDING',
    tools_used JSONB DEFAULT '[]'::jsonb,
    output_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trade Proposals
CREATE TABLE IF NOT EXISTS trade_proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_version_id UUID REFERENCES strategy_versions(id),
    instrument_key VARCHAR(100) NOT NULL,
    evidence_json JSONB NOT NULL,
    expiry TIMESTAMPTZ NOT NULL,
    requested_mode VARCHAR(20) DEFAULT 'PAPER',
    status VARCHAR(50) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Risk Decisions
CREATE TABLE IF NOT EXISTS risk_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID NOT NULL REFERENCES trade_proposals(id) ON DELETE CASCADE,
    policy_version INT NOT NULL,
    decision VARCHAR(50) NOT NULL,
    reasons_json JSONB DEFAULT '[]'::jsonb,
    reserved_amount NUMERIC(15, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Execution Intents (Unique signal bar constraint)
CREATE TABLE IF NOT EXISTS execution_intents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    signal_key VARCHAR(255) NOT NULL,
    proposal_id UUID REFERENCES trade_proposals(id),
    approved_by VARCHAR(255),
    command_hash VARCHAR(64),
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_execution_intents_signal UNIQUE (account_id, signal_key)
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    intent_id UUID NOT NULL REFERENCES execution_intents(id),
    broker_order_id VARCHAR(100) UNIQUE,
    tag VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    order_type VARCHAR(20) NOT NULL,
    qty INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order Events & Fills
CREATE TABLE IF NOT EXISTS order_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    broker_time TIMESTAMPTZ NOT NULL,
    fill_qty INT DEFAULT 0,
    fill_price NUMERIC(15, 2) DEFAULT 0.00,
    exchange_id VARCHAR(100),
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Positions
CREATE TABLE IF NOT EXISTS positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    instrument_key VARCHAR(100) NOT NULL,
    net_qty INT NOT NULL DEFAULT 0,
    avg_price NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    last_verified_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_account_instrument UNIQUE (account_id, instrument_key)
);

-- Cash Ledger & Fee Ledger
CREATE TABLE IF NOT EXISTS fee_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    category VARCHAR(50) NOT NULL, -- BROKERAGE, STT, EXCHANGE, GST, STAMP
    amount NUMERIC(15, 2) NOT NULL,
    reference_id VARCHAR(100),
    is_estimated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Events
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_type VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    before_after_hash VARCHAR(64),
    trace_id VARCHAR(100) NOT NULL,
    occurred_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outbox Events for reliable domain event dispatching
CREATE TABLE IF NOT EXISTS outbox_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    committed_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

-- Performance indices
CREATE INDEX IF NOT EXISTS idx_orders_intent ON orders(intent_id);
CREATE INDEX IF NOT EXISTS idx_order_events_order_time ON order_events(order_id, broker_time);
CREATE INDEX IF NOT EXISTS idx_proposals_expiry ON trade_proposals(expiry);
CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_events(occurred_at);
