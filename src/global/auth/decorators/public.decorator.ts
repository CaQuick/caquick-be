import { SetMetadata } from '@nestjs/common';

/**
 * Public 메타데이터 키
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 인증을 제외할 엔드포인트를 표시하는 데코레이터
 *
 * - 전역 가드가 적용된 경우, 특정 엔드포인트만 인증 제외 가능
 * - 전역 가드를 사용하지 않는 경우 이 데코레이터는 불필요
 *
 * @example
 * @Public()
 * @Get('health')
 * healthCheck() {
 *   return { status: 'ok' };
 * }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
