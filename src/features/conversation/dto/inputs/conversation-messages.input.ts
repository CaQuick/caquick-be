import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { MAX_CONVERSATION_PAGE_LIMIT } from '@/features/conversation/constants/conversation.constants';

export class ConversationMessagesInput {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CONVERSATION_PAGE_LIMIT)
  limit?: number;
}
