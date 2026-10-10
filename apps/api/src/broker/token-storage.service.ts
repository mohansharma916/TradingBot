import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const RecordSchema = z.object({ cipherText: z.string().regex(/^[a-f0-9]+$/), iv: z.string().length(24), authTag: z.string().length(32),
  expiresAt: z.string().datetime(), userId: z.string(), userType: z.string(), createdAt: z.string().datetime() });
const PayloadSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().optional(), expiresAt: z.string().datetime(),
  userId: z.string(), userType: z.string(), createdAt: z.string().datetime() });

export interface DecryptedTokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  userId: string;
  userType: string;
  createdAt: string;
}

export interface EncryptedTokenRecord {
  cipherText: string;
  iv: string;
  authTag: string;
  expiresAt: string;
  userId: string;
  userType: string;
  createdAt: string;
}

@Injectable()
export class TokenStorageService {
  private readonly logger = new Logger(TokenStorageService.name);
  private currentRecord: EncryptedTokenRecord | null = null;
  private readonly algorithm = 'aes-256-gcm';
  private readonly encryptionKey: Buffer;
  private readonly storagePath?: string;
  private readonly privateKeyConfigured: boolean;

  constructor(@Inject(EnvService) private readonly envService: EnvService, @Optional() @Inject('TOKEN_STORAGE_PATH') storagePath?: string) {
    const rawKey = this.envService.config.TOKEN_ENCRYPTION_KEY;
    const defaultKey = !rawKey || rawKey.includes('default') || rawKey.includes('change_in_production');
    this.privateKeyConfigured = !defaultKey;
    if (defaultKey && (this.envService.config.LIVE_EXECUTION_ENABLED || this.envService.config.NODE_ENV === 'production')) throw new Error('A private TOKEN_ENCRYPTION_KEY is required in production and when live execution is enabled.');
    // Derive a fixed 32-byte key using SHA-256
    this.encryptionKey = crypto.createHash('sha256').update(rawKey || crypto.randomBytes(32)).digest();
    this.storagePath = storagePath || (this.envService.config.NODE_ENV !== 'test' && !process.env.VITEST ? path.resolve(this.envService.config.STATE_DIRECTORY, 'broker-token.json') : undefined);
    if (this.storagePath && fs.existsSync(this.storagePath)) {
      try { this.currentRecord = z.object({ version: z.literal(1), record: RecordSchema.nullable() }).parse(JSON.parse(fs.readFileSync(this.storagePath, 'utf8'))).record; this.getToken(); }
      catch { throw new Error('Stored broker token cannot be validated. Credentials are blocked until storage or its encryption key is repaired.'); }
    }
  }

  /**
   * Encrypts and securely stores the Upstox OAuth token record using AES-256-GCM.
   */
  public storeToken(payload: {
    accessToken: string;
    refreshToken?: string;
    expiresInSeconds: number;
    userId: string;
    userType: string;
  }): EncryptedTokenRecord {
    if (!payload.accessToken || !Number.isFinite(payload.expiresInSeconds) || payload.expiresInSeconds <= 0) throw new Error('A token with a valid positive expiry is required.');
    if (!this.privateKeyConfigured && !/^(mock_|test_|upstox_sand_|upstox_ref_)/i.test(payload.accessToken)) throw new Error('Set a private TOKEN_ENCRYPTION_KEY before storing genuine broker credentials.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    const expiresAt = new Date(Date.now() + payload.expiresInSeconds * 1000).toISOString();
    const tokenData = JSON.stringify({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresAt,
      userId: payload.userId,
      userType: payload.userType,
      createdAt: new Date().toISOString(),
    });

    let cipherText = cipher.update(tokenData, 'utf8', 'hex');
    cipherText += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const record = {
      cipherText,
      iv: iv.toString('hex'),
      authTag,
      expiresAt,
      userId: payload.userId,
      userType: payload.userType,
      createdAt: new Date().toISOString(),
    };
    this.persist(record);
    this.currentRecord = record;

    this.logger.log(
      `[TokenStorage] OAuth token securely encrypted and stored for user '${payload.userId}'. Expires: ${expiresAt}`,
    );

    return this.currentRecord;
  }

  /**
   * Decrypts and retrieves the active token record.
   * Throws if no token exists, if authentication tag fails, or if data is tampered.
   */
  public getToken(): DecryptedTokenPayload | null {
    if (!this.currentRecord) {
      return null;
    }

    try {
      const iv = Buffer.from(this.currentRecord.iv, 'hex');
      const authTag = Buffer.from(this.currentRecord.authTag, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(this.currentRecord.cipherText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      const payload = PayloadSchema.parse(JSON.parse(decrypted));
      if (payload.expiresAt !== this.currentRecord.expiresAt || payload.userId !== this.currentRecord.userId) throw new Error('Credential metadata does not match its authenticated payload.');
      return payload;
    } catch (err: any) {
      this.logger.error(`[TokenStorage] Failed to decrypt stored token: ${err.message}`);
      throw new Error(`Token decryption failed: integrity check or authentication tag error.`);
    }
  }

  /**
   * Checks whether a valid, non-expired token exists.
   */
  public hasValidToken(): boolean {
    if (!this.currentRecord) return false;
    const expiresAt = new Date(this.currentRecord.expiresAt).getTime();
    return Date.now() < expiresAt && this.getToken() !== null;
  }

  /**
   * Returns metadata without exposing the decrypted access token.
   */
  public getTokenMetadata(): {
    exists: boolean;
    isExpired: boolean;
    expiresAt: string | null;
    secondsRemaining: number;
    userId: string | null;
  } {
    if (!this.currentRecord) {
      return {
        exists: false,
        isExpired: true,
        expiresAt: null,
        secondsRemaining: 0,
        userId: null,
      };
    }

    const expiryTime = new Date(this.currentRecord.expiresAt).getTime();
    const remaining = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
    const isExpired = remaining <= 0;

    return {
      exists: true,
      isExpired,
      expiresAt: this.currentRecord.expiresAt,
      secondsRemaining: remaining,
      userId: this.currentRecord.userId,
    };
  }

  /**
   * Purges stored credentials on session disconnect.
   */
  public clearToken(): void {
    this.persist(null);
    this.currentRecord = null;
    this.logger.log('[TokenStorage] Stored broker OAuth token purged.');
  }
  private persist(record: EncryptedTokenRecord | null): void {
    if (!this.storagePath) return;
    const directory = path.dirname(this.storagePath); const temporary = path.join(directory, `.token-${crypto.randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); descriptor = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify({ version: 1, record })}\n`); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, this.storagePath); descriptor = fs.openSync(directory, 'r'); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
    } catch { throw new Error('Encrypted broker credential could not be durably stored. Session change was rejected.'); }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  /**
   * Helper to redact sensitive tokens from strings and log payloads.
   */
  public static redactSecret(str: string): string {
    if (!str || str.length < 8) return '***REDACTED***';
    return `${str.slice(0, 4)}...${str.slice(-4)}`;
  }
}
