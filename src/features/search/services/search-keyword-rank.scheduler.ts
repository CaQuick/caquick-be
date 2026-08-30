import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ClockService } from '@/common/providers/clock.service';
import { SearchKeywordRankService } from '@/features/search/services/search-keyword-rank.service';

/**
 * 인기 검색어 스냅샷 크론(매시 정각, KST). 단일 서버 전제 — 다중 인스턴스가 되면
 * 분산 락이 필요하다(현재는 uk(ranked_at, rank) 충돌을 repo가 흡수해 중복 생성은 없다).
 * 부팅 직후 현재 정각 스냅샷이 없으면 1회 즉시 만들어, 재시작 시 빈 화면을 줄인다.
 * 스냅샷 실패는 앱 기동·다음 정각 실행을 막지 않도록 로그만 남긴다.
 */
@Injectable()
export class SearchKeywordRankScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchKeywordRankScheduler.name);

  constructor(
    private readonly rankService: SearchKeywordRankService,
    private readonly clock: ClockService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.captureSafely();
  }

  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'Asia/Seoul' })
  async handleHourly(): Promise<void> {
    await this.captureSafely();
  }

  async captureSafely(): Promise<void> {
    try {
      const created = await this.rankService.captureSnapshot(this.clock.now());
      if (created) this.logger.log('인기 검색어 스냅샷 생성');
    } catch (err) {
      this.logger.error('인기 검색어 스냅샷 생성 실패', err);
    }
  }
}
