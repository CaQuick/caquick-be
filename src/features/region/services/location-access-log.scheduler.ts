import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { LocationAccessLogService } from '@/features/region/services/location-access-log.service';

/** 크론(ScheduleModule)은 worker에만 실린다. 실패는 다음 날 다시 지우면 되므로 로그만 남긴다. */
@Injectable()
export class LocationAccessLogScheduler {
  private readonly logger = new Logger(LocationAccessLogScheduler.name);

  constructor(private readonly service: LocationAccessLogService) {}

  @Cron('0 0 4 * * *', { timeZone: 'Asia/Seoul' })
  async handleDaily(): Promise<void> {
    try {
      const deleted = await this.service.purgeExpired();
      if (deleted > 0) this.logger.log(`위치정보 확인자료 ${deleted}건 파기`);
    } catch (err) {
      this.logger.error('위치정보 확인자료 파기 실패', err);
    }
  }
}
