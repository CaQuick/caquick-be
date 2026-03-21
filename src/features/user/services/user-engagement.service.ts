import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';

@Injectable()
export class UserEngagementService extends UserBaseService {
  constructor(repo: UserRepository) {
    super(repo);
  }

  async likeReview(accountId: bigint, reviewId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const result = await this.repo.likeReview({
      accountId,
      reviewId,
    });

    if (result === 'not-found') {
      throw new NotFoundException('Review not found.');
    }
    if (result === 'self-like') {
      throw new BadRequestException('Cannot like your own review.');
    }

    return true;
  }
}
