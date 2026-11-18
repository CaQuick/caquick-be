import { IsNotEmpty, IsString } from 'class-validator';

export class SendConversationImageMessageInput {
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @IsString()
  @IsNotEmpty()
  imageUrl!: string;
}
