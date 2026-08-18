import { Injectable } from '@nestjs/common';

/**
 * 난수를 반환하는 서비스.
 *
 * 테스트에서 결정적 난수를 주입할 수 있도록 `Math.random()` 직접 호출을 대체한다
 * (ClockService와 동일한 통제 패턴).
 */
@Injectable()
export class RandomService {
  /** [0, 1) 난수. */
  random(): number {
    return Math.random();
  }

  /** [0, maxExclusive) 정수 난수. */
  int(maxExclusive: number): number {
    return Math.floor(this.random() * maxExclusive);
  }

  /**
   * 배열에서 최대 count개를 비복원 무작위 추출한다(부분 Fisher–Yates).
   * 원본 배열은 변경하지 않는다.
   */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i += 1) {
      const j = i + this.int(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
  }
}
