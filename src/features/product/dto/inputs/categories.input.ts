import { IsIn, IsOptional } from 'class-validator';

export class CategoriesInput {
  @IsOptional()
  @IsIn(['EVENT', 'STYLE', 'OTHER'])
  type?: 'EVENT' | 'STYLE' | 'OTHER';
}
