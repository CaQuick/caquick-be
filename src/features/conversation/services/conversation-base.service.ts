import { DomainException } from '@/common/errors/error-catalog';
import { evaluateActiveUserAccount } from '@/features/auth';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
export abstract class ConversationBaseService {
  protected constructor(protected readonly repo: ConversationRepository) {}

  protected async requireActiveUser(
    accountId: bigint,
  ): Promise<{ nickname: string }> {
    const account = await this.repo.findUserAccountForInquiry(accountId);
    switch (evaluateActiveUserAccount(account)) {
      case 'ACCOUNT_NOT_FOUND':
        throw new DomainException('SESSION_ACCOUNT_MISSING');
      case 'ACCOUNT_DELETED':
        throw new DomainException('ACCOUNT_DELETED');
      case 'NOT_USER':
        throw new DomainException('USER_ONLY');
      case 'PROFILE_INACTIVE':
        throw new DomainException('PROFILE_NOT_FOUND');
      case null:
        break;
    }
    // evaluate 통과 시 user_profile 존재가 보장된다
    return { nickname: account!.user_profile!.nickname };
  }
}
