import { Injectable, NotFoundException } from '@nestjs/common';

import { UserRepository } from '../repositories/user.repository';
import type { MySearchHistoriesInput } from '../types/user-input.type';
import type { SearchHistoryConnection } from '../types/user-output.type';

import { UserBaseService } from './user-base.service';

@Injectable()
export class UserSearchService extends UserBaseService {
  constructor(repo: UserRepository) {
    super(repo);
  }

  async mySearchHistories(
    accountId: bigint,
    input?: MySearchHistoriesInput,
  ): Promise<SearchHistoryConnection> {
    await this.requireActiveUser(accountId);

    const { offset, limit } = this.normalizePaginationInput(input);
    const result = await this.repo.listSearchHistories({
      accountId,
      offset,
      limit,
    });

    return {
      items: result.items.map((item) => ({
        id: item.id.toString(),
        keyword: item.keyword,
        lastUsedAt: item.last_used_at,
      })),
      totalCount: result.totalCount,
      hasMore: offset + limit < result.totalCount,
    };
  }

  async deleteSearchHistory(accountId: bigint, id: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const deleted = await this.repo.deleteSearchHistory({
      accountId,
      id,
      now: new Date(),
    });
    if (!deleted) throw new NotFoundException('Search history not found.');
    return true;
  }

  async clearSearchHistories(accountId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);
    await this.repo.clearSearchHistories({ accountId, now: new Date() });
    return true;
  }
}
