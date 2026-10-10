import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  console.log('[Trading Worker] Initializing dedicated trading runtime...');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  console.log('[Trading Worker] Runtime running and listening for market events.');
}

bootstrap().catch((err) => {
  console.error('[Trading Worker] Fatal startup crash:', err);
  process.exit(1);
});
