import { registerAs } from '@nestjs/config';

/**
 * 문서 접근 설정 타입
 */
export interface DocsConfig {
  accessToken: string | null;
}

/**
 * 문서 접근 설정
 */
export default registerAs('docs', (): DocsConfig => {
  const isProd = process.env.NODE_ENV === 'production';
  const accessToken = process.env.DOCS_ACCESS_TOKEN?.trim() ?? '';

  if (isProd && accessToken.length === 0) {
    throw new Error('DOCS_ACCESS_TOKEN must be set in production environment');
  }

  return { accessToken: accessToken.length > 0 ? accessToken : null };
});
