import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import type { Request, Response } from 'express';

import authConfig from 'src/config/auth.config';
import databaseConfig from 'src/config/database.config';
import oidcConfig from 'src/config/oidc.config';
import { AuthModule } from 'src/features/auth/auth.module';
import { SystemModule } from 'src/features/system/system.module';
import { AuthGlobalModule } from 'src/global/auth/auth-global.module';
import { LoggerModule } from 'src/global/logger/logger.module';
import { PrismaModule } from 'src/prisma';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [authConfig, databaseConfig, oidcConfig],
    }),
    PrismaModule,
    LoggerModule,
    AuthGlobalModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProd = configService.get<string>('NODE_ENV') === 'production';
        return {
          autoSchemaFile: 'src/graphql/schema.gql',
          sortSchema: true,
          playground: !isProd,
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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
