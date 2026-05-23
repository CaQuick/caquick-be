import type { TransformFnParams } from 'class-transformer';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMyProfileImageInput {
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @MinLength(1, { message: 'profileImageUrl is required.' })
  @MaxLength(2048, { message: 'profileImageUrl is too long.' })
  profileImageUrl!: string;
}
