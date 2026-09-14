import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 클라이언트가 URL 문자열을 직접 주는 입력 필드의 **전수 등록부**.
 *
 * 이런 필드는 검증이 없으면 외부 링크·타인 key 를 저장할 수 있다. 실제로 13개 중
 * 1개만 검증되던 시기가 있었고, 개별 대응으로는 새 필드가 생길 때마다 구멍이 났다.
 * 그래서 SDL 을 훑어 필드를 모으고, 아래 등록부에 없으면 **테스트가 깨지게** 한다.
 *
 * 새 필드를 추가하면 여기에 줄을 추가해야 하며, 그때 상태를 명시적으로 고르게 된다.
 */
type MediaUrlStatus =
  /** 저장 경로에서 S3Service 소유권 검증을 거친다 */
  | 'validated'
  /** 외부 링크가 의도된 필드라 소유권 검증 대상이 아니다 */
  | 'external-by-design';

const REGISTRY: Record<string, MediaUrlStatus> = {
  // ── 구매자 (presign: createProfileImageUploadUrl / createReviewMediaUploadUrl)
  'UpdateMyProfileImageInput.profileImageUrl': 'validated',
  'WriteReviewMediaInput.mediaUrl': 'validated',
  'WriteReviewMediaInput.thumbnailUrl': 'validated',

  // ── 판매자 (presign: sellerCreateUploadUrl)
  'SellerCreateProductInput.initialImageUrl': 'validated',
  'SellerCreateProductInput.baseDesignImageUrl': 'validated',
  'SellerUpdateProductInput.baseDesignImageUrl': 'validated',
  'SellerAddProductImageInput.imageUrl': 'validated',
  'SellerCreateOptionItemInput.imageUrl': 'validated',
  'SellerUpdateOptionItemInput.imageUrl': 'validated',
  'SellerUpsertProductCustomTemplateInput.baseImageUrl': 'validated',
  'SellerUpdateStoreBasicInfoInput.profileImageUrl': 'validated',

  // ── 관리자 (presign: adminCreateUploadUrl)
  'AdminCreateBannerInput.imageUrl': 'validated',
  'AdminUpdateBannerInput.imageUrl': 'validated',
  'AdminUpdateStoreBasicInfoInput.profileImageUrl': 'validated',

  // ── 외부 링크가 의도된 필드
  'AdminCreateBannerInput.linkUrl': 'external-by-design',
  'AdminUpdateBannerInput.linkUrl': 'external-by-design',
  'AdminCreateSellerInput.websiteUrl': 'external-by-design',
  'AdminUpdateStoreBasicInfoInput.websiteUrl': 'external-by-design',
  'SellerUpdateStoreBasicInfoInput.websiteUrl': 'external-by-design',
};

const SDL_ROOT = resolve(__dirname, '..', 'features');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

function sdlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sdlFiles(full));
    else if (entry.name.endsWith('.graphql')) out.push(full);
  }
  return out;
}

/** SDL 전체에서 `input` 타입의 URL 문자열 필드를 수집한다 */
function collectUrlInputFields(sources: string[]): string[] {
  const found: string[] = [];

  for (const sdl of sources) {
    let currentInput: string | null = null;

    for (const rawLine of sdl.split('\n')) {
      const line = rawLine.trim();

      const inputStart = /^input\s+([A-Za-z0-9_]+)\s*\{/.exec(line);
      if (inputStart) {
        currentInput = inputStart[1];
        continue;
      }
      if (line === '}') {
        currentInput = null;
        continue;
      }
      if (!currentInput) continue;

      // `fieldName: String!` / `fieldName: String` 형태만 본다(ID·Int 등은 URL 이 아니다)
      const field = /^([A-Za-z0-9_]+)\s*:\s*String!?\s*$/.exec(line);
      if (!field) continue;
      if (!/url$/i.test(field[1])) continue;

      found.push(`${currentInput}.${field[1]}`);
    }
  }

  return found.sort();
}

describe('미디어 URL 입력 필드 전수 등록', () => {
  const files = sdlFiles(SDL_ROOT);
  const sources = files.map((f) => readFileSync(f, 'utf8'));
  const fields = collectUrlInputFields(sources);

  it('SDL 파일을 실제로 읽었다', () => {
    // "0건이라 통과"를 막는 가드 — 대상 수를 먼저 확인한다.
    expect(files.length).toBeGreaterThan(20);
    expect(fields.length).toBeGreaterThan(0);
  });

  it('수집기가 알려진 필드를 실제로 잡는다(반증 케이스)', () => {
    // 정규식이 아무것도 매칭하지 못해 "누락 0건"이 되는 상황을 배제한다.
    expect(fields).toContain('SellerAddProductImageInput.imageUrl');
    expect(fields).toContain('AdminCreateBannerInput.linkUrl');

    // 일부러 넣은 가짜 input 도 잡혀야 한다.
    const planted = collectUrlInputFields([
      'input PlantedInput {\n  someImageUrl: String!\n}',
    ]);
    expect(planted).toEqual(['PlantedInput.someImageUrl']);

    // URL 이 아닌 필드는 잡지 않는다.
    const ignored = collectUrlInputFields([
      'input PlantedInput {\n  name: String!\n  productId: ID!\n}',
    ]);
    expect(ignored).toEqual([]);
  });

  it('등록부에 없는 URL 입력 필드가 없다', () => {
    const unregistered = fields.filter((f) => !(f in REGISTRY));

    // 새 URL 입력 필드를 만들었다면 REGISTRY 에 줄을 추가하고 상태를 고르라는 뜻이다.
    expect(unregistered).toEqual([]);
  });

  it('등록부에 SDL 에서 사라진 항목이 없다', () => {
    const stale = Object.keys(REGISTRY).filter((f) => !fields.includes(f));

    expect(stale).toEqual([]);
  });

  it('검증 대상 14건 / 외부 링크 5건', () => {
    const counted = Object.values(REGISTRY).reduce<Record<string, number>>(
      (acc, status) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }),
      {},
    );

    expect(counted).toEqual({ validated: 14, 'external-by-design': 5 });
  });
});
