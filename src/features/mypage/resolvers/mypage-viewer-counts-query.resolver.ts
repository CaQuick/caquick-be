import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';

import { UserViewerCountsService } from '@/features/mypage/services/mypage-viewer-counts.service';
import type { ViewerCounts } from '@/features/mypage/types/mypage-viewer-counts-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserViewerCountsQueryResolver {
  constructor(private readonly service: UserViewerCountsService) {}

  @Query('viewerCounts')
  viewerCounts(@CurrentUser() user: JwtUser): Promise<ViewerCounts> {
    const accountId = parseAccountId(user);
    return this.service.viewerCounts(accountId);
  }
}
