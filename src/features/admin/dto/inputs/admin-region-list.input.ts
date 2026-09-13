import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AdminRegionListInput {
  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}
