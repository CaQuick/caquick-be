import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins: string[] = isProd
    ? [
        'https://www.caquick.site',
        'https://caquick.site',
        'https://caquick-fe.vercel.app',
      ]
    : process.env.FRONTEND_BASE_URL
      ? [process.env.FRONTEND_BASE_URL]
      : [];

  // CORS 설정
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

bootstrap();
