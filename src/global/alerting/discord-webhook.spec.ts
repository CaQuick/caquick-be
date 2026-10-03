import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';

import {
  ALERT_POST_TIMEOUT_MS,
  buildDiscordPayload,
  discordTransport,
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

  it('JSON POST로 보내고 2xx면 true, 운영 기한은 ALERT_POST_TIMEOUT_MS다', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
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
    expect(timeout).toHaveBeenCalledWith(ALERT_POST_TIMEOUT_MS);
    timeout.mockRestore();
    server.close();
  });

  it('반증: 응답이 없으면 기한에 요청 자체를 끊고 false — 소켓이 남지 않는다', async () => {
    const TIMEOUT_MS = 200;
    let markClosed!: () => void;
    const closed = new Promise<void>((resolve) => (markClosed = resolve));
    const server = createServer((req) => {
      // 응답하지 않는다. 요청의 close는 본문 수신이 끝나도 오므로, 클라이언트가 끊었는지는 소켓의 close로 본다
      req.socket.once('close', () => markClosed());
    });
    const url = await listen(server);

    const started = Date.now();
    const ok = await discordTransport(TIMEOUT_MS)(
      url,
      { level: 'error', title: 't' },
      { role: 'worker', env: 'test' },
    );

    expect(ok).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
    // 서버 쪽에서 연결 종료가 관측돼야 "끊었다"(고정 대기 대신 close 이벤트를 기다린다)
    await closed;
    server.closeAllConnections();
    server.close();
  });
});
