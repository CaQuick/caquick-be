import { IsString } from 'class-validator';

export class AdminCreateTagInput {
  @IsString()
  name!: string;
}
