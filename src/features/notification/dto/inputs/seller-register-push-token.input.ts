import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  EXPO_PUSH_TOKEN_PATTERN,
  MAX_PUSH_DEVICE_ID_LENGTH,
  MAX_PUSH_TOKEN_LENGTH,
  PUSH_PLATFORMS,
  type PushPlatformValue,
} from '@/features/notification/constants/seller-push.constants';

export class SellerRegisterPushTokenInput {
  @IsString()
  @MaxLength(MAX_PUSH_TOKEN_LENGTH)
  @Matches(EXPO_PUSH_TOKEN_PATTERN)
  token!: string;

  @IsIn(PUSH_PLATFORMS)
  platform!: PushPlatformValue;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PUSH_DEVICE_ID_LENGTH)
  deviceId?: string | null;
}
