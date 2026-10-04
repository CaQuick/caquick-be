import { readdirSync, readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { listenOnLoopback } from '@/test/http-app';

@Controller('who')
class WhoController {
  @Get()
  who(): string {
    return 'app';
  }
}

/** 열린 채 남은 서버는 jest를 끝나지 못하게 하므로, 단언이 실패해도 afterEach가 닫도록 열리는 즉시 모은다 */
const intruders: Server[] = [];

/** 다른 프로세스가 같은 포트에 서버를 여는 상황. 실패하면 오류 코드를 돌려준다 */
function bindIntruder(port: number, host?: string): Promise<Server | string> {
  const server = createServer((_req, res) => res.end('intruder'));
  return new Promise((resolve) => {
    server.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? ''));
    server.listen(port, host, () => {
      intruders.push(server);
      resolve(server);
    });
  });
}

const portOf = (app: INestApplication<App>) =>
  ((app.getHttpServer() as Server).address() as AddressInfo).port;

// 리눅스(CI)는 와일드카드가 잡은 포트의 127.0.0.1 바인드 자체를 거부한다 — 가로채기는 macOS(맥미니)에서만 난다
const onMac = process.platform === 'darwin' ? it : it.skip;

describe('listenOnLoopback', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [WhoController],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
  });
  afterEach(async () => {
    for (const server of intruders.splice(0)) {
      server.closeAllConnections();
      server.close();
    }
    await app.close();
  });

  onMac(
    '반증: 와일드카드로 연 앱은 같은 포트를 127.0.0.1로 잡은 서버에 요청을 빼앗긴다',
    async () => {
      await app.listen(0); // supertest가 닫힌 서버를 여는 방식
      const intruder = await bindIntruder(portOf(app), '127.0.0.1');
      expect(intruder).toBeInstanceOf(Server);

      const res = await request(app.getHttpServer()).get('/who');
      expect(res.text).toBe('intruder');
    },
  );

  it('127.0.0.1로 열면 같은 포트를 다른 서버가 가로채지 못한다', async () => {
    await listenOnLoopback(app);
    const port = portOf(app);

    expect(await bindIntruder(port, '127.0.0.1')).toBe('EADDRINUSE');
    // 와일드카드 바인드는 macOS에서 성공하지만 127.0.0.1 요청은 더 구체적인 앱 쪽으로 간다
    await bindIntruder(port);

    const res = await request(app.getHttpServer()).get('/who');
    expect(res.text).toBe('app');
  });

  it('supertest로 앱을 부르는 spec은 모두 listenOnLoopback으로 연다', () => {
    const root = join(__dirname, '..', '..');
    const specs = ['src', 'test']
      .flatMap((dir) =>
        readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
          .filter((f) => /\.(spec|e2e-spec)\.ts$/.test(f))
          .map((f) => join(dir, f)),
      )
      .map((path) => ({ path, src: readFileSync(join(root, path), 'utf8') }))
      .filter(({ src }) => src.includes('getHttpServer()'));

    expect(specs.length).toBeGreaterThan(1);
    expect(
      specs
        .filter(({ src }) => !src.includes('listenOnLoopback('))
        .map(({ path }) => path),
    ).toEqual([]);
  });
});
