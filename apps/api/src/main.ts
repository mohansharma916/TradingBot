import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { EnvService } from './config/env.service';
import { TradingModeService } from './trading/trading-mode.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const envService = app.get(EnvService);
  app.enableShutdownHooks();

  app.setGlobalPrefix('api/v1');
  app.useWebSocketAdapter(new WsAdapter(app));

  const corsOrigins = envService.config.CORS_ORIGIN.split(',').map((s) => s.trim());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const port = envService.config.PORT;
  await app.listen(port, envService.config.API_HOST);
  console.log(`[Trading Platform API] listening on http://localhost:${port}/api/v1`);
  console.log(`[Trading Platform WebSocket] listening on ws://localhost:${port}/ws`);



  console.log(`[Safety Invariant] Operating Mode: ${app.get(TradingModeService).getMode()}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error starting Trading Platform API:', err);
  process.exit(1);
});
