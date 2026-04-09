import { join } from 'node:path';

import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ServeStaticModule } from '@nestjs/serve-static';
import type { Request, Response } from 'express';

import authConfig from '@/config/auth.config';
import databaseConfig from '@/config/database.config';
import docsConfig from '@/config/docs.config';
import oidcConfig from '@/config/oidc.config';
import s3Config from '@/config/s3.config';
import { AuthModule } from '@/features/auth/auth.module';
import { SellerModule } from '@/features/seller/seller.module';
import { SystemModule } from '@/features/system/system.module';
import { UserModule } from '@/features/user/user.module';
import { AuthGlobalModule } from '@/global/auth/auth-global.module';
import { GraphqlGlobalModule } from '@/global/graphql/graphql.module';
import { LoggerModule } from '@/global/logger/logger.module';
import { DocsAccessMiddleware } from '@/global/middlewares/docs-access.middleware';
import { PrismaModule } from '@/prisma';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [authConfig, databaseConfig, docsConfig, oidcConfig, s3Config],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/gql-docs',
    }),
    PrismaModule,
    LoggerModule,
    AuthGlobalModule,
    GraphqlGlobalModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProd = configService.get<string>('NODE_ENV') === 'production';
        return {
          typePaths: [
            isProd
              ? join(process.cwd(), 'dist/features/**/*.graphql')
              : join(process.cwd(), 'src/features/**/*.graphql'),
          ],
          playground: false,
          plugins: [
            isProd
              ? ApolloServerPluginLandingPageDisabled()
              : ApolloServerPluginLandingPageLocalDefault({ embed: true }),
          ],
          context: ({
            req,
            res,
          }: {
            req: Request;
            res?: Response;
          }): {
            req: Request;
            res?: Response;
          } => ({ req, res }),
        };
      },
    }),
    SystemModule,
    AuthModule,
    UserModule,
    SellerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(DocsAccessMiddleware)
      .forRoutes(
        { path: 'rest-docs', method: RequestMethod.ALL },
        { path: 'rest-docs/*path', method: RequestMethod.ALL },
        { path: 'rest-docs-json', method: RequestMethod.ALL },
        { path: 'gql-docs', method: RequestMethod.ALL },
        { path: 'gql-docs/*path', method: RequestMethod.ALL },
      );
  }
}
