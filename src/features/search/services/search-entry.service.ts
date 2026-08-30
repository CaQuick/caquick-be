import { BadRequestException, Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { normalizeSearchKeyword } from '@/common/utils/search-keyword';
import { SEARCH_ERROR_MESSAGES } from '@/features/search/constants/search-error-messages';
import { SearchRepository } from '@/features/search/repositories/search.repository';

@Injectable()
export class SearchEntryService {
  constructor(
    private readonly repo: SearchRepository,
    private readonly clock: ClockService,
  ) {}

  /**
   * 검색 실행 기록. 정규화(trim·공백 축약)된 검색어를 저장해 최근 검색어·인기 검색어가
   * 같은 키로 모이게 한다. 비로그인(accountId undefined)은 집계 이벤트만 남긴다.
   */
  async recordSearch(rawKeyword: string, accountId?: bigint): Promise<boolean> {
    const keyword = this.requireKeyword(rawKeyword);
    await this.repo.recordSearch({
      accountId: accountId ?? null,
      keyword,
      now: this.clock.now(),
    });
    return true;
  }

  private requireKeyword(raw: string): string {
    const result = normalizeSearchKeyword(raw);
    if (result.ok) return result.keyword;
    throw new BadRequestException(
      result.reason === 'EMPTY'
        ? SEARCH_ERROR_MESSAGES.KEYWORD_EMPTY
        : SEARCH_ERROR_MESSAGES.KEYWORD_TOO_LONG,
    );
  }
}
