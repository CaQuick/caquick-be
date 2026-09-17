import { Injectable } from '@nestjs/common';

/** 테스트에서 결정적 난수를 주입하려고 `Math.random()` 직접 호출을 대체한다. */
@Injectable()
export class RandomService {
  random(): number {
    return Math.random();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.random() * maxExclusive);
  }

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
