import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  MAX_PUSH_DEVICE_ID_LENGTH,
  MAX_PUSH_TOKEN_LENGTH,
  PUSH_PLATFORMS,
  type PushPlatformValue,
} from '@/features/notification/constants/seller-push.constants';

export class SellerRegisterPushTokenInput {
  // Expo 형식은 서비스가 INVALID_PUSH_TOKEN으로 검사한다 — 여기서 걸면 VALIDATION_FAILED가 돼 SDL 계약과 어긋난다.
  @IsString()
  @MaxLength(MAX_PUSH_TOKEN_LENGTH)
  token!: string;

  @IsIn(PUSH_PLATFORMS)
  platform!: PushPlatformValue;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PUSH_DEVICE_ID_LENGTH)
  deviceId?: string | null;
}
