import { join } from 'node:path';

import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import {
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
  type DynamicModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';

import { CommonModule } from '@/common/common.module';
import alertingConfig from '@/config/alerting.config';
import appConfig, {
  APP_ROLE_TOKEN,
  type AppRole,
  runsBackgroundJobs,
  servesHttpApi,
} from '@/config/app.config';
import authConfig from '@/config/auth.config';
import databaseConfig from '@/config/database.config';
import docsConfig from '@/config/docs.config';
import oidcConfig from '@/config/oidc.config';
import outboxConfig from '@/config/outbox.config';
import rabbitmqConfig from '@/config/rabbitmq.config';
import redisConfig from '@/config/redis.config';
import s3Config from '@/config/s3.config';
import { AuthModule } from '@/features/auth/auth.module';
import { ConversationModule } from '@/features/conversation';
import { DashboardModule } from '@/features/dashboard/dashboard.module';
import { MypageModule } from '@/features/mypage/mypage.module';
import { NotificationModule } from '@/features/notification';
import { OutboxModule } from '@/features/outbox';
import { RegionModule } from '@/features/region';
import { SearchModule } from '@/features/search/search.module';
import { StoreModule } from '@/features/store';
import { SystemModule } from '@/features/system/system.module';
import { AlertingModule } from '@/global/alerting';
import { AuthGlobalModule } from '@/global/auth/auth-global.module';
import { BlacklistModule } from '@/global/auth/blacklist';
import { buildGraphqlContext } from '@/global/graphql/graphql-context.helper';
import { GraphqlGlobalModule } from '@/global/graphql/graphql.module';
import { LoggerModule } from '@/global/logger/logger.module';
import { DocsAccessMiddleware } from '@/global/middlewares/docs-access.middleware';
import { WorkerRouteMiddleware } from '@/global/middlewares/worker-route.middleware';
import { PubSubModule } from '@/global/pubsub';
import { RedisModule } from '@/global/redis';
import {
  RequestContextMiddleware,
  RequestContextModule,
} from '@/global/request-context';
import { StorageModule } from '@/global/storage/storage.module';
import { PrismaModule } from '@/prisma';

/** GraphQL·정적 문서는 요청을 받는 역할(api·ws)만 싣는다. worker는 /health·(05) /metrics만 연다. */
function httpModules(): NonNullable<DynamicModule['imports']> {
  return [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/gql-docs',
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProd = configService.get<string>('NODE_ENV') === 'production';
        // ts-jest(모듈 해석이 cjs/esm으로 갈림)에서 플러그인 제네릭 타입이 어긋나 spec이 AppModule을 못 연다 — 드라이버 설정 타입으로 고정
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc에는 불필요하지만 ts-jest 해석에서 필요
        return {
          typePaths: [
            isProd
              ? join(process.cwd(), 'dist/features/**/*.graphql')
              : join(process.cwd(), 'src/features/**/*.graphql'),
          ],
          playground: false,
          // 실시간 subscription(graphql-ws). 인증은 connectionParams →
          // buildGraphqlContext가 HTTP 헤더로 이식해 기존 JWT 가드를 재사용한다.
          subscriptions: {
            'graphql-ws': true,
          },
          plugins: [
            isProd
              ? ApolloServerPluginLandingPageDisabled()
              : ApolloServerPluginLandingPageLocalDefault({ embed: true }),
          ],
          context: buildGraphqlContext,
        } as Omit<ApolloDriverConfig, 'driver'>;
      },
    }),
  ];
}

@Module({})
export class AppModule implements NestModule {
  constructor(@Inject(APP_ROLE_TOKEN) private readonly role: AppRole) {}

  /** 같은 이미지가 역할 플래그로 갈린다(P2 E1). main.ts가 env를 읽어 넘기고, 테스트는 역할별로 compile해 배선을 본다. */
  static forRole(role: AppRole): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          load: [
            alertingConfig,
            appConfig,
            authConfig,
            databaseConfig,
            docsConfig,
            oidcConfig,
            outboxConfig,
            rabbitmqConfig,
            redisConfig,
            s3Config,
          ],
        }),
        CommonModule,
        PrismaModule,
        RequestContextModule,
        LoggerModule,
        AlertingModule,
        AuthGlobalModule,
        GraphqlGlobalModule,
        RedisModule,
        BlacklistModule,
        PubSubModule,
        StorageModule,
        // 크론(SearchModule)은 worker만 — api가 같이 돌리면 같은 스냅샷을 두 번 만든다
        ...(runsBackgroundJobs(role) ? [ScheduleModule.forRoot()] : []),
        ...(servesHttpApi(role) ? httpModules() : []),
        SystemModule,
        AuthModule,
        ConversationModule,
        RegionModule,
        SearchModule,
        StoreModule,
        NotificationModule,
        OutboxModule,
        DashboardModule,
        MypageModule,
      ],
      // configure()가 env를 다시 읽지 않고 이 역할을 쓴다 — imports 배선과 미들웨어 게이트가 한 값에서 나온다
      providers: [{ provide: APP_ROLE_TOKEN, useValue: role }],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // 모든 요청(REST·GraphQL)에 대해 요청 컨텍스트(client IP/UA/requestId)를 가장 먼저 연다.
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });

    if (!servesHttpApi(this.role)) {
      // worker: 요청 컨텍스트 다음, 어떤 컨트롤러보다 먼저 — 허용 목록 밖은 여기서 끝난다
      consumer
        .apply(WorkerRouteMiddleware)
        .forRoutes({ path: '*path', method: RequestMethod.ALL });
      return;
    }
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
