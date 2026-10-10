import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { OwnerAuthService } from './owner-auth.service';

@Injectable()
export class OwnerAuthGuard implements CanActivate {
  constructor(@Inject(OwnerAuthService) private readonly auth: OwnerAuthService) {}
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true; // WebSocket authentication is enforced on connection.
    const request = context.switchToHttp().getRequest();
    const pathname = request.path as string;
    if (['/api/v1/auth/login', '/api/v1/health/live'].includes(pathname)) return true;
    // Broker redirects carry an unpredictable, one-use OAuth state, validated by OAuthService.
    if (request.method === 'GET' && pathname === '/api/v1/broker/upstox/callback') return true;
    const authorization = request.headers.authorization as string | undefined;
    this.auth.verify(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
    return true;
  }
}
