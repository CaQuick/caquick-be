import { registerAs } from '@nestjs/config';

/**
 * S3 설정 타입
 */
export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  presignExpiresSeconds: number;
}

/**
 * S3 설정
 *
 * 운영 환경에서는 IAM Role 사용을 권장하며,
 * 로컬/개발 환경에서는 Access Key로 인증한다.
 */
export default registerAs('s3', (): S3Config => {
  const isProd = process.env.NODE_ENV === 'production';
  const bucket = process.env.AWS_S3_BUCKET?.trim() ?? '';

  if (isProd && !bucket) {
    throw new Error('AWS_S3_BUCKET must be set in production environment');
  }

  const presignExpires = Number(process.env.S3_PRESIGN_EXPIRES_SECONDS);

  return {
    region: process.env.AWS_REGION?.trim() || 'ap-northeast-2',
    bucket: bucket || 'caquick-media-dev',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim() || undefined,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim() || undefined,
    presignExpiresSeconds:
      Number.isFinite(presignExpires) && presignExpires > 0
        ? presignExpires
        : 600,
  };
});
