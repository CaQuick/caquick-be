import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/** 테스트에서 결정적 식별자를 주입하려고 `randomUUID()` 직접 호출을 대체한다. */
@Injectable()
export class IdGenerator {
  uuid(): string {
    return randomUUID();
  }
}
