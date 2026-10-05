import { IsString, MaxLength } from 'class-validator';

import { MAX_PUSH_TOKEN_LENGTH } from '@/features/notification/constants/seller-push.constants';

/** 형식 검사는 하지 않는다 — 어떤 문자열이든 본인 행이 없으면 true로 끝난다. */
export class SellerUnregisterPushTokenInput {
  @IsString()
  @MaxLength(MAX_PUSH_TOKEN_LENGTH)
  token!: string;
}
