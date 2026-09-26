import { EventEmitter } from 'node:events';

import {
  Controller,
  Get,
  type INestApplication,
  Injectable,
  type MiddlewareConsumer,
  Module,
  type NestMiddleware,
  type NestModule,
  type OnModuleInit,
  RequestMethod,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';

import {
  ABORTED_STATUS,
  HttpMetricsMiddleware,
  routeLabel,
  UNMATCHED_ROUTE,
} from '@/global/metrics/http-metrics.middleware';
import { MetricsService } from '@/global/metrics/metrics.service';

@Controller('items')
class ItemsController {
  @Get(':id')
  get() {
    return { ok: true };
  }
}

/** Apollo처럼 app.use로 마운트 — Route를 만들지 않아 req.route는 그대로고 baseUrl만 바뀐다 */
@Injectable()
class MountGraphql implements OnModuleInit {
  constructor(private readonly host: HttpAdapterHost) {}
  onModuleInit(): void {
    const app = this.host.httpAdapter.getInstance<{
      use: (
        path: string,
        handler: (req: Request, res: Response) => void,
      ) => void;
    }>();
    app.use('/graphql', (_req, res) => {
      res.status(200).end('{}');
    });
  }
}

/** WorkerRouteMiddleware처럼 또 다른 '*path' Route에서 404로 끝낸다 */
@Injectable()
class BlockMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (req.path.startsWith('/blocked')) {
      res.status(404).end();
      return;
    }
    next();
  }
}

@Module({
  controllers: [ItemsController],
  providers: [MetricsService, MountGraphql],
})
class TestAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(HttpMetricsMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
    consumer
      .apply(BlockMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}

describe('HttpMetricsMiddleware (실제 Express 스택)', () => {
  let app: INestApplication<App>;
  let metrics: MetricsService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
    await app.init();
    metrics = app.get(MetricsService);
  });
  afterAll(() => app.close());

  it('컨트롤러 패턴·app.use 마운트(/graphql)·미매칭 404·다른 *path 미들웨어의 404가 각각의 라벨로 — 미들웨어 자신의 /*path나 실제 경로는 새지 않는다', async () => {
    await request(app.getHttpServer()).get('/items/42').expect(200);
    await request(app.getHttpServer()).post('/graphql').expect(200);
    await request(app.getHttpServer()).get('/no/such/42').expect(404);
    await request(app.getHttpServer()).get('/blocked/7').expect(404);

    const text = await metrics.text();
    expect(text).toContain(
      'caquick_http_request_duration_seconds_count{method="GET",route="/items/:id",status="200"} 1',
    );
    expect(text).toContain(
      'caquick_http_request_duration_seconds_count{method="POST",route="/graphql",status="200"} 1',
    );
    expect(text).toContain(
      `caquick_http_request_duration_seconds_count{method="GET",route="${UNMATCHED_ROUTE}",status="404"} 2`,
    );
    expect(text).not.toContain('*path');
    expect(text).not.toContain('/items/42');
    expect(text).not.toContain('blocked');
  });
});

function fakeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    method: 'GET',
    path: '/x',
    baseUrl: '',
    ...overrides,
  } as unknown as Request;
}
function fakeRes(statusCode: number): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  (res as { statusCode: number }).statusCode = statusCode;
  return res;
}

describe('HttpMetricsMiddleware (가짜 req/res)', () => {
  it("응답 'finish'에 실제 상태 코드로 관측한다 — 가드 거절(401)도 인터셉터와 달리 잡힌다. 뒤따르는 'close'는 두 번 세지 않는다", async () => {
    const metrics = new MetricsService();
    const req = fakeReq({ route: { path: '/*path' } });
    const res = fakeRes(401);
    const next = jest.fn();

    new HttpMetricsMiddleware(metrics).use(req, res, next);
    expect(next).toHaveBeenCalled();
    (req as { route: unknown }).route = { path: '/auth/oidc/:provider/start' };
    res.emit('finish');
    res.emit('close');

    const text = await metrics.text();
    expect(text).toContain(
      'caquick_http_request_duration_seconds_count{method="GET",route="/auth/oidc/:provider/start",status="401"} 1',
    );
    expect(text).not.toContain('/x');
  });

  it("반증: 클라이언트가 끊으면 'finish' 없이 'close'만 온다 — status=aborted로 센다(안 세면 타임아웃 사고가 지표에서 사라진다)", async () => {
    const metrics = new MetricsService();
    const res = fakeRes(200);
    new HttpMetricsMiddleware(metrics).use(fakeReq(), res, jest.fn());
    res.emit('close');

    expect(await metrics.text()).toContain(
      `route="${UNMATCHED_ROUTE}",status="${ABORTED_STATUS}"} 1`,
    );
  });

  it('처리 시간은 finish까지 초 단위로 잰다(_sum)', async () => {
    const metrics = new MetricsService();
    const now = jest
      .spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_250);
    const req = fakeReq();
    const res = fakeRes(200);
    new HttpMetricsMiddleware(metrics).use(req, res, jest.fn());
    (req as { route: unknown }).route = { path: '/health/ready' };
    res.emit('finish');
    now.mockRestore();

    expect(await metrics.text()).toContain(
      'caquick_http_request_duration_seconds_sum{method="GET",route="/health/ready",status="200"} 0.25',
    );
  });

  it('routeLabel — 진입 시 Route 그대로(컨트롤러 미매칭)·다른 와일드카드 Route(워커 차단)·path 비문자열은 <unmatched>, app.use 마운트는 baseUrl, 컨트롤러 패턴으로 바뀌면 그 패턴', () => {
    const entered = { path: '/*path' };
    expect(routeLabel(fakeReq({ route: entered }), entered)).toBe(
      UNMATCHED_ROUTE,
    );
    expect(routeLabel(fakeReq({ route: { path: '/*path' } }), entered)).toBe(
      UNMATCHED_ROUTE,
    );
    expect(routeLabel(fakeReq({ route: { path: 42 } }), entered)).toBe(
      UNMATCHED_ROUTE,
    );
    expect(
      routeLabel(fakeReq({ route: entered, baseUrl: '/graphql' }), entered),
    ).toBe('/graphql');
    expect(
      routeLabel(fakeReq({ route: { path: '/items/:id' } }), entered),
    ).toBe('/items/:id');
  });
});
