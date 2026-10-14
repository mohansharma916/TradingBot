import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Inject, Optional } from '@nestjs/common';
import { IncomingMessage } from 'node:http';
import { OwnerAuthService } from '../auth/owner-auth.service';
import { EnvService } from '../config/env.service';
import { DataJournalService } from '../journal/data-journal.service';

@WebSocketGateway({ path: '/ws' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private clients = new Set<WebSocket>();
  private credentials = new Map<WebSocket, string>();

  constructor(@Optional() @Inject(OwnerAuthService) private readonly auth?: OwnerAuthService,
    @Optional() @Inject(EnvService) private readonly env?: EnvService,
    @Optional() @Inject(DataJournalService) private readonly journal?: DataJournalService) {}

  handleConnection(client: WebSocket, request: IncomingMessage) {
    try {
      if (!this.auth || !this.env) throw new Error('Owner authentication unavailable');
      const origin = request.headers.origin;
      if (origin && !this.env.config.CORS_ORIGIN.split(',').map(value => value.trim()).includes(origin)) throw new Error('Origin denied');
      const token = request.headers['sec-websocket-protocol']?.split(',').map(value => value.trim())[1] ?? '';
      this.auth.verify(token);
      this.credentials.set(client, token);
    } catch { client.close(1008, 'Owner login required'); return; }
    this.clients.add(client);
    client.send(
      JSON.stringify({
        topic: 'system.connected',
        payload: { message: 'Connected to Workstation Real-Time Stream', timestamp: new Date().toISOString() },
      }),
    );
  }

  handleDisconnect(client: WebSocket) {
    this.clients.delete(client);
    this.credentials.delete(client);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: WebSocket, data: { topics: string[] }) {
    try { if (!this.auth) throw new Error('Owner authentication unavailable'); this.auth.verify(this.credentials.get(client) ?? ''); }
    catch { client.close(1008, 'Owner login required'); return; }
    client.send(
      JSON.stringify({
        topic: 'subscription.ack',
        payload: { subscribedTopics: data?.topics || ['*'] },
      }),
    );
  }

  public broadcast(topic: string, payload: any) {
    this.journal?.recordBroadcast(topic, payload);
    const msg = JSON.stringify({ topic, payload });
    for (const client of this.clients) {
      try { if (!this.auth) throw new Error('Owner authentication unavailable'); this.auth.verify(this.credentials.get(client) ?? ''); }
      catch { client.close(1008, 'Owner session expired'); this.clients.delete(client); continue; }
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }
}
