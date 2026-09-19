import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { IsStrongPassword } from '@/common/validators/strong-password.validator';
import {
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_PATTERN,
} from '@/features/auth';
import { AdminCreateSellerStoreInput } from '@/features/store/dto/inputs/admin-create-seller-store.input';

export class AdminCreateSellerInput {
  @IsString()
  @Length(MIN_USERNAME_LENGTH, MAX_USERNAME_LENGTH)
  @Matches(USERNAME_PATTERN)
  username!: string;

  @IsStrongPassword()
  password!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ACCOUNT_NAME_LENGTH)
  name?: string | null;

  @IsString()
  businessName!: string;

  @IsString()
  businessPhone!: string;

  @IsOptional()
  @IsString()
  websiteUrl?: string | null;

  @IsDefined()
  @ValidateNested()
  @Type(() => AdminCreateSellerStoreInput)
  store!: AdminCreateSellerStoreInput;
}
