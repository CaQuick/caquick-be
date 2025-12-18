import { Query, Resolver } from '@nestjs/graphql';

@Resolver()
export class PingResolver {
  @Query(() => String, { name: 'ping' })
  ping(): string {
    return 'pong';
  }
}
