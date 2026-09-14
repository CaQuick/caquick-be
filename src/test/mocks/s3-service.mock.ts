import type { Provider } from '@nestjs/common';

import { S3Service } from '@/global/storage/s3.service';

/**
 * S3Service 목. 업로드 URL 소유권 검증을 쓰는 서비스 spec 이 공유한다.
 *
 * 기본값은 "우리가 발급한 URL"(통과). 거절 분기를 보는 테스트만
 * `rejectUploadUrls()` 로 뒤집는다 — 실제 URL 판정 규칙(host·prefix·traversal)은
 * s3.service.spec.ts 가 전수로 검증하므로 여기서 다시 흉내내지 않는다.
 */
export interface S3ServiceMock extends jest.Mocked<S3Service> {
  /**
   * 소유권 검증을 실패시킨다.
   *
   * `only` 를 주면 그 URL 만 거절한다 — 한 호출에서 여러 URL 을 검증하는 경로
   * (예: 상품 생성의 대표 이미지 + 기본 디자인 이미지)에서 두 번째 필드가
   * 첫 필드의 거절에 가려지지 않게 하려면 필요하다.
   */
  rejectUploadUrls(options?: { message?: string; only?: string }): void;
}

export function createS3ServiceMock(): S3ServiceMock {
  const mock = {
    createUploadUrl: jest.fn(),
    isOwnedUploadUrl: jest.fn().mockReturnValue(true),
    assertOwnedUploadUrl: jest.fn(),
    assertOwnedUploadUrlIfPresent: jest.fn(),
    rejectUploadUrls(options: { message?: string; only?: string } = {}) {
      const message = options.message ?? 'NOT_OWNED';
      const matches = (url: string | null | undefined): boolean =>
        options.only === undefined ? true : url === options.only;

      mock.isOwnedUploadUrl.mockImplementation((url: string) => !matches(url));
      const reject = (url: string | null | undefined): void => {
        if (matches(url)) throw new Error(message);
      };
      mock.assertOwnedUploadUrl.mockImplementation(reject);
      mock.assertOwnedUploadUrlIfPresent.mockImplementation(reject);
    },
  } as unknown as S3ServiceMock;

  return mock;
}

/** providers 배열에 그대로 펼쳐 넣는 provider */
export function s3ServiceMockProvider(mock: S3ServiceMock): Provider {
  return { provide: S3Service, useValue: mock };
}
