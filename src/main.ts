import 'reflect-metadata';

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { ValidationError } from 'class-validator';

import { AppModule } from './app.module';

import { HttpExceptionFilter } from 'src/global/filters/global-exception.filter';
import { ApiResponseInterceptor } from 'src/global/interceptors/api-response.interceptor';
import { GqlLoggingInterceptor } from 'src/global/interceptors/gql-logging.interceptor';
import { HttpLoggingInterceptor } from 'src/global/interceptors/http-logging.interceptor';
import { CustomLoggerService } from 'src/global/logger/custom-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const isProd = configService.get<string>('NODE_ENV') === 'production';
  const frontendFromEnv =
    configService
      .get<string>('FRONTEND_BASE_URL')
      ?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];
  const allowedOrigins: string[] = isProd
    ? [
        'https://www.caquick.site',
        'https://caquick.site',
        'https://caquick-fe.vercel.app',
      ]
    : frontendFromEnv.length > 0
      ? frontendFromEnv
      : ['http://localhost:3000'];

  // CORS 설정
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const logger = app.get(CustomLoggerService);
  const httpAdapterHost = app.get(HttpAdapterHost);

  app.useLogger(logger);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          message: errors.map((e) => ({
            property: e.property,
            constraints: e.constraints ?? {},
          })),
        }),
    }),
  );

  app.useGlobalInterceptors(
    new HttpLoggingInterceptor(logger),
    new GqlLoggingInterceptor(logger),
    new ApiResponseInterceptor(new Set(['/health', '/health/profiles'])),
  );

  app.useGlobalFilters(
    new HttpExceptionFilter(httpAdapterHost.httpAdapter, logger),
  );

  const portFromEnv = configService.get<string>('PORT');
  const port = Number.isFinite(Number(portFromEnv))
    ? Number(portFromEnv)
    : 4000;

  await app.listen(port);
}

bootstrap();
