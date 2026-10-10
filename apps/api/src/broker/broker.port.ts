import {
  BrokerHealth,
  BrokerOrder,
  Instrument,
  Position,
  ProtectionResult,
} from '@trading-bot/contracts';

export interface FundsSnapshot {
  currency: string;
  availableCash: number;
  usedMargin: number;
  totalCollateral: number;
  payinAmount: number;
  spanMargin: number;
  exposureMargin: number;
}

export interface MarginEstimate {
  requiredMargin: number;
  finalMargin: number;
  shortfall: number;
}

export interface OrderAcknowledgement {
  orderId: string;
  tag: string;
  status: string;
  message: string;
}

export interface BrokerPort {
  readonly brokerName: string;
  getConnectionHealth(): Promise<BrokerHealth>;
  getFunds(): Promise<FundsSnapshot>;
  getMargin(instrumentKey: string, quantity: number, price?: number): Promise<MarginEstimate>;
  getInstrument(key: string): Promise<Instrument | undefined>;
  getOrders(): Promise<BrokerOrder[]>;
  getPositions(): Promise<Position[]>;
  placeOrder(req: any): Promise<OrderAcknowledgement>;
  modifyOrder(req: any): Promise<OrderAcknowledgement>;
  cancelOrder(orderId: string): Promise<void>;
  placeProtectiveExit?(req: any): Promise<ProtectionResult>;
}
