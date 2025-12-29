import { Query, Resolver } from '@nestjs/graphql';

@Resolver('Query')
export class PingResolver {
  @Query('ping')
  ping(): string {
    return 'pong';
  }
}
