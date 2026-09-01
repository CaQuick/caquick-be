import { IsNotEmpty, IsString } from 'class-validator';

export class SendConversationFaqMessageInput {
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @IsString()
  @IsNotEmpty()
  faqTopicId!: string;
}
