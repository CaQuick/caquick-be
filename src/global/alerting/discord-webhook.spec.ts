import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';

import {
  ALERT_POST_TIMEOUT_MS,
  buildDiscordPayload,
  postDiscordAlert,
} from '@/global/alerting/discord-webhook';

describe('buildDiscordPayload', () => {
  const at = new Date('2026-09-24T12:00:00.000Z');

  it('레벨 접두·본문·색·출처 푸터·시각을 embed 1개로 만든다', () => {
    const payload = buildDiscordPayload(
      { level: 'error', title: 'outbox FAILED', detail: 'x#1 5회 실패' },
      { role: 'worker', env: 'production' },
      at,
    );

    expect(payload).toEqual({
      username: 'caquick-be',
      embeds: [
        {
          title: '[error] outbox FAILED',
          description: 'x#1 5회 실패',
          color: 0xef4444,
          footer: { text: `production · worker · ${hostname()}` },
          timestamp: '2026-09-24T12:00:00.000Z',
        },
      ],
    });
  });

  it('반증: 긴 본문은 Discord 한도 아래로 자른다', () => {
    const payload = buildDiscordPayload(
      { level: 'warn', title: 't', detail: 'a'.repeat(5_000) },
      { role: 'api', env: 'test' },
      at,
    ) as { embeds: Array<{ description: string; color: number }> };

    expect(payload.embeds[0].description).toHaveLength(1_800);
    expect(payload.embeds[0].color).toBe(0xf59e0b);
  });
});

describe('postDiscordAlert (real http)', () => {
  async function listen(server: Server): Promise<string> {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address() as { port: number };
    return `http://127.0.0.1:${address.port}/hook`;
  }

  it('JSON POST로 보내고 2xx면 true', async () => {
    let body = '';
    const server = createServer((req, res) => {
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        res.writeHead(204);
        res.end();
      });
    });
    const url = await listen(server);

    const ok = await postDiscordAlert(
      url,
      { level: 'warn', title: 't' },
      { role: 'api', env: 'test' },
    );

    expect(ok).toBe(true);
    expect(JSON.parse(body)).toMatchObject({ username: 'caquick-be' });
    server.close();
  });

  it('반증: 응답이 없으면 기한에 요청 자체를 끊고 false — 소켓이 남지 않는다', async () => {
    let aborted = false;
    const server = createServer((req) => {
      // 응답하지 않는다. 클라이언트가 끊으면 close가 온다
      req.on('close', () => {
        aborted = true;
      });
    });
    const url = await listen(server);

    const started = Date.now();
    const ok = await postDiscordAlert(
      url,
      { level: 'error', title: 't' },
      { role: 'worker', env: 'test' },
    );

    expect(ok).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      ALERT_POST_TIMEOUT_MS - 50,
    );
    // 서버 쪽에서 연결 종료가 관측돼야 "끊었다"
    await new Promise((r) => setTimeout(r, 100));
    expect(aborted).toBe(true);
    server.closeAllConnections();
    server.close();
  }, 10_000);
});
