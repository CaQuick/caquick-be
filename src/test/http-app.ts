import type { INestApplication } from '@nestjs/common';

/**
 * supertest에 넘길 앱은 127.0.0.1에 먼저 연다. supertest는 닫힌 서버를 와일드카드(::)로 열고 127.0.0.1로 요청하는데,
 * macOS는 다른 프로세스가 같은 포트를 127.0.0.1로 따로 바인드하게 두고 요청을 그쪽으로 보낸다(맥미니의 에디터 프로세스가
 * 401을 돌려준 간헐 실패). 127.0.0.1에 열어 두면 같은 주소·포트는 다른 프로세스가 잡지 못한다.
 */
export async function listenOnLoopback(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}
