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
} from 'class-validator';

import {
  MAX_NICKNAME_LENGTH,
  MIN_BIRTH_DATE,
  MIN_NICKNAME_LENGTH,
  PHONE_FORMAT_EXAMPLE,
  PHONE_REGEX,
} from '@/features/user/constants/user.constants';

const NICKNAME_REGEX = /^[A-Za-z0-9가-힣_]+$/;

export class CompleteOnboardingInput {
  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MaxLength(50)
  name?: string | null;

  @IsString()
  @Length(MIN_NICKNAME_LENGTH, MAX_NICKNAME_LENGTH)
  @Matches(NICKNAME_REGEX, {
    message: 'Nickname contains invalid characters.',
  })
  nickname!: string;

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
