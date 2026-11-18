import { S3ServiceException } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { S3Service } from '@/global/storage/s3.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  ...jest.requireActual<object>('@aws-sdk/client-s3'),
  S3Client: jest.fn().mockImplementation(() => ({
    send: (command: unknown) => mockSend(command),
  })),
  GetObjectCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

const HEADER_BYTES = 64 * 1024;
const HOST = 'caquick-media-test.s3.ap-northeast-2.amazonaws.com';
const KEY = 'product-images/1/2026-06-10/base.png';
const URL_ = `https://${HOST}/${KEY}`;

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

/** SOI → 꽉 찬 APP1 세그먼트(65535) → SOF0. SOF가 앞 64KB 밖에 놓인다. */
function jpegWithSofAfterHeader(width: number, height: number): Uint8Array {
  const app = 0xffff;
  const bytes = new Uint8Array(2 + 2 + app + 19);
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8, 0xff, 0xe1]);
  view.setUint16(4, app);
  const sof = 4 + app;
  bytes.set([0xff, 0xc0], sof);
  view.setUint16(sof + 2, 17);
  bytes[sof + 4] = 8;
  view.setUint16(sof + 5, height);
  view.setUint16(sof + 7, width);
  return bytes;
}

/** Range 요청이면 앞부분만, 아니면 전체를 돌려주는 S3 응답. */
function serve(object: Uint8Array) {
  mockSend.mockImplementation((input: { Range?: string }) => {
    const bytes = input.Range ? object.slice(0, HEADER_BYTES) : object;
    return Promise.resolve({
      Body: { transformToByteArray: () => Promise.resolve(bytes) },
      ContentRange: input.Range
        ? `bytes 0-${bytes.length - 1}/${object.length}`
        : undefined,
    });
  });
}

function s3Error(status: number, name: string) {
  return new S3ServiceException({
    name,
    $fault: status < 500 ? 'client' : 'server',
    $metadata: { httpStatusCode: status },
    message: name,
  });
}

describe('S3Service.readImageSize', () => {
  let service: S3Service;
  const logger = { error: jest.fn() };

  beforeEach(async () => {
    mockSend.mockReset();
    logger.error.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        S3Service,
        {
          provide: ConfigService,
          useValue: {
            get: () => ({
              region: 'ap-northeast-2',
              bucket: 'caquick-media-test',
              presignExpiresSeconds: 600,
            }),
          },
        },
        { provide: CustomLoggerService, useValue: logger },
      ],
    }).compile();
    service = moduleRef.get(S3Service);
  });

  it('앞 64KB만 읽어 크기를 구한다', async () => {
    serve(png(1200, 1199));

    await expect(service.readImageSize(URL_)).resolves.toEqual({
      width: 1200,
      height: 1199,
    });
    expect(mockSend.mock.calls).toEqual([
      [
        {
          Bucket: 'caquick-media-test',
          Key: KEY,
          Range: `bytes=0-${HEADER_BYTES - 1}`,
        },
      ],
    ]);
  });

  it('SOF가 앞 64KB 밖이면 전체를 다시 읽어 크기를 구한다', async () => {
    const jpeg = jpegWithSofAfterHeader(800, 600);
    expect(jpeg.length).toBeGreaterThan(HEADER_BYTES);
    serve(jpeg);

    await expect(service.readImageSize(URL_)).resolves.toEqual({
      width: 800,
      height: 600,
    });
    expect(
      mockSend.mock.calls.map(([c]) => (c as { Range?: string }).Range),
    ).toEqual([`bytes=0-${HEADER_BYTES - 1}`, undefined]);
  });

  it('작은 객체를 다 읽었는데 이미지가 아니면 다시 읽지 않고 null이다', async () => {
    serve(new TextEncoder().encode('not an image'));

    await expect(service.readImageSize(URL_)).resolves.toBeNull();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('큰 객체가 끝까지 이미지가 아니면 전체를 읽고도 null이다', async () => {
    serve(new Uint8Array(HEADER_BYTES * 2).fill(0x41));

    await expect(service.readImageSize(URL_)).resolves.toBeNull();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it.each([
    [404, 'NoSuchKey'],
    [416, 'InvalidRange'],
  ])('객체를 읽을 수 없으면(%i %s) null이다', async (status, name) => {
    mockSend.mockRejectedValue(s3Error(status, name));

    await expect(service.readImageSize(URL_)).resolves.toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ['S3 5xx', s3Error(503, 'SlowDown')],
    ['권한 거부', s3Error(403, 'AccessDenied')],
    ['네트워크 오류', new Error('socket hang up')],
  ])('%s면 S3_READ_FAILED(503)이고 원인을 남긴다', async (_label, error) => {
    mockSend.mockRejectedValue(error);

    await expect(service.readImageSize(URL_)).rejects.toThrowDomain(
      'S3_READ_FAILED',
    );
    expect(logger.error).toHaveBeenCalledWith(
      'S3 객체 읽기 실패',
      expect.objectContaining({ key: KEY }),
    );
  });

  it.each([
    ['다른 버킷', `https://other.s3.ap-northeast-2.amazonaws.com/${KEY}`],
    ['URL 아님', 'not a url'],
  ])('%s의 URL은 읽지 않고 null이다', async (_label, url) => {
    await expect(service.readImageSize(url)).resolves.toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
