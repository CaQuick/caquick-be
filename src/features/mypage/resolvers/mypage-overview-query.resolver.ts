import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';

import { UserMypageService } from '@/features/mypage/services/mypage-overview.service';
import type { MyPageOverview } from '@/features/mypage/types/mypage-overview-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserMypageQueryResolver {
  constructor(private readonly mypageService: UserMypageService) {}

  @Query('myPageOverview')
  myPageOverview(@CurrentUser() user: JwtUser): Promise<MyPageOverview> {
    const accountId = parseAccountId(user);
    return this.mypageService.getOverview(accountId);
  }
}
