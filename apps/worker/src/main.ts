import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  console.log('[Trading Worker] Initializing passive API observer...');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  console.log('[Trading Worker] Observer running; account dispatch remains owned by the API.');
}

bootstrap().catch((err) => {
  console.error('[Trading Worker] Fatal startup crash:', err);
  process.exit(1);
});
