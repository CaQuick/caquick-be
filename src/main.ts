import 'reflect-metadata';
// .env를 가장 먼저 — 아래 import들(역할 선택·로거)이 env를 읽는다
import '@/config/preload-env';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { ValidationError } from 'class-validator';
import cookieParser from 'cookie-parser';
import type { Application as ExpressApplication } from 'express';

import { AppModule } from '@/app.module';
import { readAlertingConfig } from '@/config/alerting.config';
import { resolveAppRole, servesHttpApi } from '@/config/app.config';
import type { AuthConfig } from '@/config/auth.config';
import { postDiscordAlert, shouldSendBootAlert } from '@/global/alerting';
import { HttpExceptionFilter } from '@/global/filters/global-exception.filter';
import { GraphQLExceptionFilter } from '@/global/filters/graphql-exception.filter';
import {
  ApiResponseInterceptor,
  RAW_RESPONSE_PATHS,
} from '@/global/interceptors/api-response.interceptor';
import { GqlLoggingInterceptor } from '@/global/interceptors/gql-logging.interceptor';
import { HttpLoggingInterceptor } from '@/global/interceptors/http-logging.interceptor';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';

async function bootstrap(): Promise<void> {
  const role = resolveAppRole();
  // abortOnError:false — 기본값이면 DI·config 단계 실패를 Nest가 process.exit(1)로 끝내 아래 catch(부팅 경보·stderr 봉투)에 닿지 않는다
  const app = await NestFactory.create(AppModule.forRole(role), {
    bufferLogs: true,
    abortOnError: false,
  });
  app.enableShutdownHooks();

  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as { version?: string };

  const configService = app.get(ConfigService);
  const isProd = configService.get<string>('NODE_ENV') === 'production';
  // 허용 오리진 목록도 authConfig가 단일 소스(P1-11a)
  const frontendFromEnv =
    configService.getOrThrow<AuthConfig>('auth').frontendOrigins;
  const allowedOrigins: string[] = isProd
    ? [
        'https://www.caquick.site',
        'https://caquick.site',
        'https://caquick-fe.vercel.app',
      ]
    : frontendFromEnv.length > 0
      ? frontendFromEnv
      : ['http://localhost:3000'];

  // Trust proxy (env-based) — reverse proxy 뒤에서 X-Forwarded-For 처리.
  // TRUST_PROXY_HOPS = proxy hop 수 (ex. ELB 1대 → 1, CloudFront+ELB → 2).
  // 미설정 / 0 이면 비활성 (default Express 동작). 잘못 설정 시 IP spoofing 위험이므로
  // 운영 인프라 (ELB/CloudFront/Nginx) hop 수를 정확히 맞춰야 한다.
  const trustProxyHops =
    Number(configService.get<string>('TRUST_PROXY_HOPS')) || 0;
  if (trustProxyHops > 0) {
    const expressApp = app.getHttpAdapter().getInstance() as ExpressApplication;
    expressApp.set('trust proxy', trustProxyHops);
  }

  // CORS 설정
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.use(cookieParser());

  const logger = app.get(CustomLoggerService);
  const httpAdapterHost = app.get(HttpAdapterHost);

  // Nest 내부 로그도 Winston을 지나야 컨테이너 로그가 한 형식(JSON)·한 라벨(role)이 된다(P2 E8)
  app.useLogger(logger);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        // 필터가 VALIDATION_FAILED로 매핑하는 유일한 Nest 예외 직접 생성
        // eslint-disable-next-line no-restricted-syntax
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
    new ApiResponseInterceptor(RAW_RESPONSE_PATHS),
  );

  const gqlExceptionFilter = new GraphQLExceptionFilter(logger);
  app.useGlobalFilters(
    new HttpExceptionFilter(
      httpAdapterHost.httpAdapter,
      logger,
      gqlExceptionFilter,
    ),
  );

  if (servesHttpApi(role)) setupSwagger(app, pkg.version);

  const portFromEnv = configService.get<string>('PORT');
  const port = Number.isFinite(Number(portFromEnv))
    ? Number(portFromEnv)
    : 4000;

  await app.listen(port);
  logger.log(`caquick-be 기동 — role=${role} port=${port}`);
}

/** REST 문서는 요청을 받는 역할에만 — worker는 문서를 낼 라우트가 없다. */
function setupSwagger(app: INestApplication, version?: string): void {
  const documentConfig = new DocumentBuilder()
    .setTitle('CaQuick REST API')
    .setDescription('CaQuick REST API 문서')
    .setVersion(version ?? '0.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addCookieAuth(
      'caquick_rt',
      { type: 'apiKey', in: 'cookie' },
      'refresh-cookie',
    )
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig);
  SwaggerModule.setup('rest-docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

// 부팅 실패는 DI가 없을 수 있어(모듈 compile 전) 전송 함수를 직접 부른다. 감독자가 자동 재시작하므로
// 같은 호스트에서 창 안에는 한 번만 보낸다(파일 억제). stderr는 파이프일 수 있어 flush를 기다린 뒤 종료한다.
bootstrap().catch(async (error: unknown) => {
  const { discordWebhookUrl, dedupeWindowMs } = readAlertingConfig();
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (discordWebhookUrl && shouldSendBootAlert(Date.now(), dedupeWindowMs)) {
    await postDiscordAlert(
      discordWebhookUrl,
      { level: 'error', title: '부팅 실패', detail },
      {
        role: process.env.APP_ROLE ?? 'api',
        env: process.env.NODE_ENV ?? 'development',
      },
    );
  }
  await new Promise<void>((resolve) => {
    process.stderr.write(`caquick-be 부팅 실패\n${detail}\n`, () => resolve());
  });
  process.exit(1);
});
