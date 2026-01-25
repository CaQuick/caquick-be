import { join } from 'node:path';

import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ServeStaticModule } from '@nestjs/serve-static';
import type { Request, Response } from 'express';

import authConfig from 'src/config/auth.config';
import databaseConfig from 'src/config/database.config';
import oidcConfig from 'src/config/oidc.config';
import { AuthModule } from 'src/features/auth/auth.module';
import { SystemModule } from 'src/features/system/system.module';
import { UserModule } from 'src/features/user/user.module';
import { AuthGlobalModule } from 'src/global/auth/auth-global.module';
import { GraphqlGlobalModule } from 'src/global/graphql/graphql.module';
import { LoggerModule } from 'src/global/logger/logger.module';
import { PrismaModule } from 'src/prisma';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [authConfig, databaseConfig, oidcConfig],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
