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
  DeleteObjectsCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

interface DeleteInput {
  Bucket: string;
  Delete: { Objects: { Key: string }[]; Quiet: boolean };
}

const sentKeyCounts = () =>
  (mockSend.mock.calls as [DeleteInput][]).map(
    ([input]) => input.Delete.Objects.length,
  );

describe('S3Service.deleteObjects', () => {
  let service: S3Service;
  const logger = { error: jest.fn(), warn: jest.fn() };

  beforeEach(async () => {
    mockSend.mockReset();
    logger.error.mockClear();
    const module = await Test.createTestingModule({
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
    service = module.get(S3Service);
  });

  it('이 버킷에 조용한 모드로 한 번에 지우고, 오류가 없으면 실패 없음이다', async () => {
    mockSend.mockResolvedValue({});

    await expect(service.deleteObjects(['a.png', 'b.png'])).resolves.toEqual(
      [],
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toEqual({
      Bucket: 'caquick-media-test',
      Delete: { Objects: [{ Key: 'a.png' }, { Key: 'b.png' }], Quiet: true },
    });
  });

  it('키별 오류는 키·코드로 돌려준다', async () => {
    mockSend.mockResolvedValue({
      Errors: [{ Key: 'b.png', Code: 'AccessDenied', Message: 'denied' }],
    });

    await expect(service.deleteObjects(['a.png', 'b.png'])).resolves.toEqual([
      { key: 'b.png', code: 'AccessDenied' },
    ]);
  });

  it('요청 자체가 실패하면 그 묶음 전부를 실패로 돌려주고 던지지 않는다', async () => {
    mockSend.mockRejectedValue(
      new S3ServiceException({
        name: 'AccessDenied',
        $fault: 'client',
        $metadata: { httpStatusCode: 403 },
        message: 'denied',
      }),
    );

    await expect(service.deleteObjects(['a.png', 'b.png'])).resolves.toEqual([
      { key: 'a.png', code: 'AccessDenied' },
      { key: 'b.png', code: 'AccessDenied' },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      'S3 객체 삭제 실패',
      expect.objectContaining({ keys: 2 }),
    );
  });

  it('1000개를 넘으면 1000개씩 나눠 보내고, 실패한 묶음만 실패로 돌려준다', async () => {
    const keys = Array.from({ length: 1001 }, (_, i) => `k${i}`);
    mockSend
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('socket hang up'));

    const failures = await service.deleteObjects(keys);

    expect(sentKeyCounts()).toEqual([1000, 1]);
    expect(failures).toEqual([{ key: 'k1000', code: 'Error' }]);
  });

  it('빈 목록이면 요청하지 않는다', async () => {
    await expect(service.deleteObjects([])).resolves.toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
