import { Injectable } from '@nestjs/common';

/** 테스트에서 결정적 시각을 주입하려고 `new Date()` 직접 호출을 대체한다. */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}
