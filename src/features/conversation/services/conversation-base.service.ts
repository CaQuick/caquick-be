import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { CONVERSATION_ERRORS } from '@/features/conversation/constants/conversation-error-messages';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { evaluateActiveUserAccount } from '@/features/user';

/** 구매자 대화 서비스 공통 — 활성 USER 판정(user feature 정책 헬퍼 공유). */
export abstract class ConversationBaseService {
  protected constructor(protected readonly repo: ConversationRepository) {}

  protected async requireActiveUser(
    accountId: bigint,
  ): Promise<{ nickname: string }> {
    const account = await this.repo.findUserAccountForInquiry(accountId);
    switch (evaluateActiveUserAccount(account)) {
      case 'ACCOUNT_NOT_FOUND':
        throw new UnauthorizedException(CONVERSATION_ERRORS.ACCOUNT_NOT_FOUND);
      case 'ACCOUNT_DELETED':
        throw new UnauthorizedException(CONVERSATION_ERRORS.ACCOUNT_DELETED);
      case 'NOT_USER':
        throw new ForbiddenException(CONVERSATION_ERRORS.NOT_USER);
      case 'PROFILE_INACTIVE':
        throw new UnauthorizedException(CONVERSATION_ERRORS.PROFILE_INACTIVE);
      case null:
        break;
    }
    // evaluate 통과 시 user_profile 존재가 보장된다
    return { nickname: account!.user_profile!.nickname };
  }
}
