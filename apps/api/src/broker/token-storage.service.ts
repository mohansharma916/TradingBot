import { Injectable, Logger, Inject } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import crypto from 'node:crypto';

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

  constructor(@Inject(EnvService) private readonly envService: EnvService) {
    const rawKey = this.envService.config.TOKEN_ENCRYPTION_KEY || 'default_32_byte_aes_gcm_token_encryption_key';
    // Derive a fixed 32-byte key using SHA-256
    this.encryptionKey = crypto.createHash('sha256').update(rawKey).digest();
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

    this.currentRecord = {
      cipherText,
      iv: iv.toString('hex'),
      authTag,
      expiresAt,
      userId: payload.userId,
      userType: payload.userType,
      createdAt: new Date().toISOString(),
    };

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

      return JSON.parse(decrypted) as DecryptedTokenPayload;
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
    return Date.now() < expiresAt;
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
    this.currentRecord = null;
    this.logger.log('[TokenStorage] Stored broker OAuth token purged.');
  }

  /**
   * Helper to redact sensitive tokens from strings and log payloads.
   */
  public static redactSecret(str: string): string {
    if (!str || str.length < 8) return '***REDACTED***';
    return `${str.slice(0, 4)}...${str.slice(-4)}`;
  }
}
