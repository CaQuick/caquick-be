import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { MetricsController } from '@/features/system/metrics.controller';
import {
  ApiResponseInterceptor,
  RAW_RESPONSE_PATHS,
} from '@/global/interceptors/api-response.interceptor';
import { MetricsService } from '@/global/metrics';

/** 제외 목록 밖 경로가 실제로 봉투에 싸이는지 볼 대조군 */
@Controller('envelope-probe')
class EnvelopeProbeController {
  @Get()
  get(): { ok: boolean } {
    return { ok: true };
  }
}

// 반환값이 아니라 실제로 나가는 상태·헤더·본문을 본다 — @Res passthrough가 빠지거나 봉투에 싸이는 사고는 여기서만 잡힌다
describe('MetricsController (real app)', () => {
  let app: INestApplication<App>;
  let metrics: MetricsService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MetricsController, EnvelopeProbeController],
      providers: [MetricsService],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
    app.useGlobalInterceptors(new ApiResponseInterceptor(RAW_RESPONSE_PATHS));
    await app.init();
    metrics = module.get(MetricsService);
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /metrics → 200, Prometheus 텍스트(content-type·# HELP), 봉투 없음', async () => {
    metrics.httpRequestDuration.observe(
      { method: 'GET', route: '/x', status: '200' },
      0.01,
    );
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    // Express가 charset을 끼워 넣어 순서가 바뀐다 — Prometheus는 type과 version만 본다
    expect(res.headers['content-type']).toMatch(
      /^text\/plain;.*version=0\.0\.4/,
    );
    expect(res.text.startsWith('# HELP')).toBe(true);
    expect(res.text).toContain('caquick_http_request_duration_seconds_count');
    expect(res.text.trimStart().startsWith('{')).toBe(false); // JSON 봉투가 아니다
  });

  it('반증: collect가 던지는 게이지가 있어도 200이고 나머지 지표가 나간다', async () => {
    metrics.registerGauge({
      name: 'caquick_test_broken',
      help: 't',
      collect: () => {
        throw new Error('DB down');
      },
    });
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('caquick_metrics_collect_errors_total');
    expect(res.text).toContain('caquick_process_cpu_seconds_total');
  });

  it('대조군: 제외 목록 밖 경로는 봉투에 싸인다', async () => {
    const res = await request(app.getHttpServer())
      .get('/envelope-probe')
      .expect(200);
    expect(res.body).toMatchObject({ data: { ok: true } });
  });
});
