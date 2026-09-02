import { IsNotEmpty, IsString } from 'class-validator';

export class SendConversationMessageInput {
  @IsString()
  @IsNotEmpty()
  storeId!: string;

  @IsString()
  @IsNotEmpty()
  bodyText!: string;
}
