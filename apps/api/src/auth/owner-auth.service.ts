import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { EnvService } from '../config/env.service';

@Injectable()
export class OwnerAuthService {
  private readonly salt = randomBytes(32);
  private readonly session = randomBytes(32).toString('hex');
  private readonly passwordHash: Buffer | null;
  private readonly revoked = new Set<string>();
  private failures = new Map<string, { count: number; until: number }>();
  constructor(@Inject(EnvService) private readonly env: EnvService) {
    this.passwordHash = env.config.OWNER_PASSWORD ? scryptSync(env.config.OWNER_PASSWORD, this.salt, 64) : null;
    if (env.config.NODE_ENV === 'production' && (!this.passwordHash || env.config.JWT_SECRET.startsWith('super_secret_dev'))) throw new Error('Production requires OWNER_PASSWORD and a private JWT_SECRET.');
  }
  login(username: string, password: string, address = 'local'): { token: string; expiresAt: string } {
    if (!this.passwordHash) throw new ServiceUnavailableException('Configure OWNER_PASSWORD (at least 12 characters) in the server environment, then restart.');
    const record = this.failures.get(address);
    if (record && record.count >= 5 && record.until > Date.now()) throw new UnauthorizedException('Too many login attempts. Try again in 15 minutes.');
    const candidate = scryptSync(typeof password === 'string' ? password.slice(0, 512) : '', this.salt, 64);
    if (username !== this.env.config.OWNER_USERNAME || !timingSafeEqual(candidate, this.passwordHash)) {
      this.failures.set(address, { count: record && record.until > Date.now() ? record.count + 1 : 1, until: Date.now() + 900000 });
      throw new UnauthorizedException('Invalid owner credentials.');
    }
    this.failures.delete(address);
    const expiry = Math.floor(Date.now() / 1000) + 8 * 3600;
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'owner', sid: this.session, exp: expiry, jti: randomBytes(24).toString('hex') })).toString('base64url');
    const signature = createHmac('sha256', this.env.config.JWT_SECRET).update(`${head}.${body}`).digest('base64url');
    return { token: `${head}.${body}.${signature}`, expiresAt: new Date(expiry * 1000).toISOString() };
  }
  verify(token: string): { sub: 'owner'; exp: number; jti: string } {
    try {
      const [head, body, signature, extra] = token.split('.');
      if (!head || !body || !signature || extra) throw new Error();
      const expected = createHmac('sha256', this.env.config.JWT_SECRET).update(`${head}.${body}`).digest();
      const actual = Buffer.from(signature, 'base64url');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
      const header = JSON.parse(Buffer.from(head, 'base64url').toString());
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (header.alg !== 'HS256' || payload.sub !== 'owner' || payload.sid !== this.session || typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000 || typeof payload.jti !== 'string' || this.revoked.has(payload.jti)) throw new Error();
      return payload;
    } catch { throw new UnauthorizedException('Owner login required.'); }
  }
  logout(token: string): void { this.revoked.add(this.verify(token).jti); }
}
