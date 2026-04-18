import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * UUID 등 식별자 생성을 캡슐화하는 서비스.
 *
 * 테스트에서 결정적 식별자를 주입할 수 있도록 `randomUUID()` 직접 호출을 대체한다.
 */
@Injectable()
export class IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}
