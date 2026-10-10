import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';

@WebSocketGateway({ path: '/ws' })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private clients = new Set<WebSocket>();

  handleConnection(client: WebSocket) {
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
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: WebSocket, data: { topics: string[] }) {
    client.send(
      JSON.stringify({
        topic: 'subscription.ack',
        payload: { subscribedTopics: data?.topics || ['*'] },
      }),
    );
  }

  public broadcast(topic: string, payload: any) {
    const msg = JSON.stringify({ topic, payload });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }
}
