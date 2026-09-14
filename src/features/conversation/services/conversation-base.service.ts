import { domainError } from '@/common/errors';
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
        throw domainError('ACCOUNT_NOT_FOUND');
      case 'ACCOUNT_DELETED':
        throw domainError('ACCOUNT_DELETED');
      case 'NOT_USER':
        throw domainError('USER_ACCOUNT_REQUIRED');
      case 'PROFILE_INACTIVE':
        throw domainError('USER_PROFILE_NOT_FOUND');
      case null:
        break;
    }
    // evaluate 통과 시 user_profile 존재가 보장된다
    return { nickname: account!.user_profile!.nickname };
  }
}
