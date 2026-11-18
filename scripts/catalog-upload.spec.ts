import {
  contentTypeOf,
  parseCatalogUploadArgs,
  planCatalogUpload,
} from './catalog-upload-plan';

describe('catalog-upload 인자', () => {
  it.each([
    [
      ['--bucket', 'caquick-media-prod'],
      { bucket: 'caquick-media-prod', dryRun: false },
    ],
    [
      ['--dry-run', '--bucket', 'caquick-media-dev'],
      { bucket: 'caquick-media-dev', dryRun: true },
    ],
  ])('%j → %j', (argv, expected) => {
    expect(parseCatalogUploadArgs(argv)).toEqual(expected);
  });

  // 반증 — 버킷 없이·잘못된 형태로는 어느 버킷에도 올리지 않는다
  it.each([
    [[], '--bucket'],
    [['--dry-run'], '--bucket'],
    [['--bucket'], '알 수 없는 인자'],
    [['--bucket=caquick-media-prod'], '알 수 없는 인자'],
    [['--bucket', '--dry-run'], '알 수 없는 인자'],
    [['--bucket', 'Caquick_Media'], '알 수 없는 인자'],
    [['--bucket', 'caquick-media-dev', '--force'], '알 수 없는 인자'],
  ])('반증: %j 는 던진다', (argv, message) => {
    expect(() => parseCatalogUploadArgs(argv)).toThrow(message);
  });
});

describe('catalog-upload 형식', () => {
  it.each([
    ['deco/number-0.png', 'image/png'],
    ['design/wave.webp', 'image/webp'],
    ['x/a.jpg', 'image/jpeg'],
  ])('%s → %s', (path, type) => {
    expect(contentTypeOf(path)).toBe(type);
  });

  it.each(['notes.txt', '.DS_Store', 'png'])('반증: %s 는 던진다', (path) => {
    expect(() => contentTypeOf(path)).toThrow('올릴 수 없는 에셋 형식');
  });
});

describe('catalog-upload 계획', () => {
  const a = { key: 'p/a.png', md5: 'aaa' };
  const b = { key: 'p/b.png', md5: 'bbb' };

  it('없는 것만 올리고 같은 ETag는 건너뛴다', () => {
    expect(
      planCatalogUpload(
        [a, b],
        new Map([
          [a.key, '"aaa"'],
          [b.key, null],
        ]),
      ),
    ).toEqual([b]);
  });

  it('조회 결과가 없는 key도 올린다', () => {
    expect(planCatalogUpload([a], new Map())).toEqual([a]);
  });

  it('반증: 같은 경로에 다른 내용이 있으면 하나도 올리지 않고 던진다', () => {
    expect(() =>
      planCatalogUpload(
        [a, b],
        new Map([
          [a.key, '"zzz"'],
          [b.key, null],
        ]),
      ),
    ).toThrow('p/a.png');
  });
});
