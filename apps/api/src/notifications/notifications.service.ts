import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import {
  AlertSeverity,
  SystemAlert,
} from '@trading-bot/contracts';
import { EventsGateway } from '../websocket/events.gateway';
import crypto from 'node:crypto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private alerts: Map<string, SystemAlert> = new Map();

  constructor(@Inject(EventsGateway) private readonly gateway: EventsGateway) {
  }

  public dispatchAlert(params: {
    severity: AlertSeverity;
    category:
      | 'RISK_GATE'
      | 'FEED_STALE'
      | 'RECONCILIATION'
      | 'KILL_SWITCH'
      | 'ORDER_EXECUTION'
      | 'PROTECTION_FAILURE'
      | 'SYSTEM';
    title: string;
    message: string;
  }): SystemAlert {
    const alert: SystemAlert = {
      id: crypto.randomUUID(),
      severity: params.severity,
      category: params.category,
      title: params.title,
      message: params.message,
      acknowledged: false,
      timestamp: new Date().toISOString(),
    };

    this.alerts.set(alert.id, alert);

    if (alert.severity === AlertSeverity.CRITICAL || alert.severity === AlertSeverity.EMERGENCY) {
      this.logger.error(`[ALERT ${alert.severity}] [${alert.category}] ${alert.title}: ${alert.message}`);
    } else {
      this.logger.warn(`[ALERT ${alert.severity}] [${alert.category}] ${alert.title}: ${alert.message}`);
    }

    this.gateway.broadcast('alert.created', alert);
    return alert;
  }

  public acknowledgeAlert(id: string): SystemAlert {
    const alert = this.alerts.get(id);
    if (!alert) {
      throw new NotFoundException(`Alert with ID '${id}' not found.`);
    }

    alert.acknowledged = true;
    this.alerts.set(id, alert);
    this.gateway.broadcast('alert.acknowledged', { id, acknowledged: true });
    return alert;
  }

  public getAlerts(limit = 50): SystemAlert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  public triggerDrillAlert(severity: AlertSeverity = AlertSeverity.WARNING): SystemAlert {
    return this.dispatchAlert({
      severity,
      category: 'SYSTEM',
      title: 'Incident Recovery Drill Alert',
      message: 'Simulated operational drill: checking in-app alert delivery.',
    });
  }
}
