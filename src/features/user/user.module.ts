import { Module } from '@nestjs/common';

import { UserRepository } from './repositories/user.repository';
import { UserMutationResolver } from './resolvers/user-mutation.resolver';
import { UserQueryResolver } from './resolvers/user-query.resolver';
import { UserService } from './user.service';

/**
 * User 도메인 모듈
 */
@Module({
  providers: [
    UserService,
    UserRepository,
    UserQueryResolver,
    UserMutationResolver,
  ],
})
export class UserModule {}
