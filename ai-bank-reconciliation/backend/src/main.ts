import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';
import { json } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { parseCorsOrigins } from './config/env.validation.js';

async function bootstrap() {
  // Production: only warnings/errors. Never log request bodies, tokens,
  // passwords, or AI keys (no such logging exists in src/ by policy).
  const app = await NestFactory.create(AppModule, {
    logger:
      process.env.NODE_ENV === 'production' ? ['error', 'warn'] : undefined,
  });

  // Security headers (helmet defaults; CSP disabled — API has no frontend
  // content to protect and strict CSP breaks nothing here, but the API
  // serves file downloads where CSP is irrelevant).
  app.use(helmet({ contentSecurityPolicy: false }));

  // Explicit JSON body limit (file uploads go through multer separately).
  app.use(json({ limit: '1mb' }));

  // CORS allow-list from env; '*' only for local development.
  const origins = parseCorsOrigins(process.env.CORS_ORIGIN);
  app.enableCors({
    origin: origins === true ? true : origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Step 19: let browsers read the correlation ID on API responses.
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
