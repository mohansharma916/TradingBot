import { Injectable } from '@nestjs/common';
import { EnvSchema, EnvConfig } from '@trading-bot/contracts';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

const rootEnv = path.resolve(__dirname, '../../../../.env');
const localEnv = path.resolve(process.cwd(), '.env');

if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
} else if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
} else {
  dotenv.config();
}

@Injectable()
export class EnvService {
  public readonly config: EnvConfig;

  constructor() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Environment validation failed:', parsed.error.format());
      throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    }
    this.config = parsed.data;
  }
}
