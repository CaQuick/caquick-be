import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard } from '../../../global/auth';
import type { JwtUser } from '../../../global/auth';
import type {
  MyNotificationsInput,
  MySearchHistoriesInput,
} from '../types/user-input.type';
import type {
  MePayload,
  NotificationConnection,
  SearchHistoryConnection,
  ViewerCounts,
} from '../types/user-output.type';
import { UserService } from '../user.service';

/**
 * 일반 유저 Query 리졸버
 */
@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserQueryResolver {
  constructor(private readonly userService: UserService) {}

  @Query('me')
  me(@CurrentUser() user: JwtUser): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.userService.me(accountId);
  }

  @Query('viewerCounts')
  viewerCounts(@CurrentUser() user: JwtUser): Promise<ViewerCounts> {
    const accountId = parseAccountId(user);
    return this.userService.viewerCounts(accountId);
  }

  @Query('myNotifications')
  myNotifications(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: MyNotificationsInput,
  ): Promise<NotificationConnection> {
    const accountId = parseAccountId(user);
    return this.userService.myNotifications(accountId, input);
  }

  @Query('mySearchHistories')
  mySearchHistories(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: MySearchHistoriesInput,
  ): Promise<SearchHistoryConnection> {
    const accountId = parseAccountId(user);
    return this.userService.mySearchHistories(accountId, input);
  }
}

/**
 * JWT 사용자 정보에서 accountId를 추출한다.
 */
function parseAccountId(user: JwtUser): bigint {
  try {
    return BigInt(user.accountId);
  } catch {
    throw new BadRequestException('Invalid account id.');
  }
}
