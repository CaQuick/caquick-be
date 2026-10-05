import { IsOptional, IsString } from 'class-validator';

/** 날짜 형식·존재 여부는 service가 parseKstDate로 판정한다(pickupTimeSlots와 동일). */
export class SellerDashboardInput {
  @IsOptional()
  @IsString()
  date?: string | null;
}
