import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { LocationAccessLogRepository } from '@/features/region/repositories/location-access-log.repository';
import { RegionAdminRepository } from '@/features/region/repositories/region-admin.repository';
import { RegionRepository } from '@/features/region/repositories/region.repository';
import { AdminRegionMutationResolver } from '@/features/region/resolvers/region-admin-mutation.resolver';
import { AdminRegionQueryResolver } from '@/features/region/resolvers/region-admin-query.resolver';
import { RegionLocationQueryResolver } from '@/features/region/resolvers/region-location-query.resolver';
import { RegionQueryResolver } from '@/features/region/resolvers/region-query.resolver';
import { LocationAccessLogScheduler } from '@/features/region/services/location-access-log.scheduler';
import { LocationAccessLogService } from '@/features/region/services/location-access-log.service';
import { AdminRegionService } from '@/features/region/services/region-admin.service';
import { RegionLocationService } from '@/features/region/services/region-location.service';
import { RegionService } from '@/features/region/services/region.service';
import { fetchKakaoLocal, KAKAO_LOCAL_TRANSPORT } from '@/global/kakao-local';

@Module({
  // 관리자 지역 마스터 CRUD: 관리자 컨텍스트(AuthModule)·감사 기록(AuditLogModule)
  imports: [AuthModule, AuditLogModule],
  providers: [
    RegionRepository,
    RegionService,
    RegionQueryResolver,
    RegionAdminRepository,
    AdminRegionService,
    AdminRegionQueryResolver,
    AdminRegionMutationResolver,
    // 위치정보 이용 확인자료(기록·보존 기간 파기). 크론은 AppModule의 ScheduleModule.forRoot()가 worker에서만 켠다
    LocationAccessLogRepository,
    LocationAccessLogService,
    LocationAccessLogScheduler,
    // 현재 위치 → 지역(카카오 로컬 좌표 → 행정구역)
    { provide: KAKAO_LOCAL_TRANSPORT, useValue: fetchKakaoLocal },
    RegionLocationService,
    RegionLocationQueryResolver,
  ],
})
export class RegionModule {}
