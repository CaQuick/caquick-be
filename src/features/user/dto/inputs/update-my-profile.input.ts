import type { TransformFnParams } from 'class-transformer';
import { Transform } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinDate,
  MinLength,
} from 'class-validator';

import {
  MAX_NICKNAME_LENGTH,
  MIN_BIRTH_DATE,
  MIN_NICKNAME_LENGTH,
  PHONE_FORMAT_EXAMPLE,
  PHONE_REGEX,
} from '@/features/user/constants/user.constants';

const NICKNAME_REGEX = /^[A-Za-z0-9가-힣_]+$/;

/** "최소 한 필드 이상 전송" 규칙은 도메인 invariant라 service에서 검증한다(class-validator로 표현하기 어렵다). */
export class UpdateMyProfileInput {
  @IsOptional()
  @IsString()
  @Length(MIN_NICKNAME_LENGTH, MAX_NICKNAME_LENGTH)
  @Matches(NICKNAME_REGEX, {
    message: 'Nickname contains invalid characters.',
  })
  nickname?: string | null;

  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MinLength(1, { message: 'Name cannot be empty.' })
  @MaxLength(50)
  name?: string | null;

  @IsOptional()
  @IsDate()
  @MinDate(MIN_BIRTH_DATE, {
    message: 'birthDate is too old (before 1900-01-01).',
  })
  birthDate?: Date | null;

  @IsOptional()
  @IsString()
  @Matches(PHONE_REGEX, {
    message: `Invalid phone number format. Expected ${PHONE_FORMAT_EXAMPLE}.`,
  })
  phoneNumber?: string | null;
}
