import { registerAs } from '@nestjs/config';

export interface MetricsConfig {
  /** /metrics의 Bearer 토큰. 운영은 필수 — api가 공개 인터넷(Tunnel)에 있어 운영 정보를 무인증으로 내주면 안 된다. */
  accessToken: string | null;
}

export default registerAs('metrics', (): MetricsConfig => {
  const isProd = process.env.NODE_ENV === 'production';
  const accessToken = process.env.METRICS_ACCESS_TOKEN?.trim() ?? '';
  if (isProd && accessToken.length === 0) {
    throw new Error(
      'METRICS_ACCESS_TOKEN must be set in production environment',
    );
  }
  return { accessToken: accessToken.length > 0 ? accessToken : null };
});
