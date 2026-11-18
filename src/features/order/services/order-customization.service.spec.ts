import { Test } from '@nestjs/testing';

import type {
  CreateOrderCustomInput,
  CreateOrderFreeEditInput,
  CreateOrderSlotCustomInput,
  CreateOrderThreeDCustomInput,
} from '@/features/order/dto/inputs/create-order-custom.input';
import { OrderCustomizationService } from '@/features/order/services/order-customization.service';
import type { ProductDetailRow } from '@/features/product';
import type { CustomImageKind, CustomMode } from '@/generated/prisma/client';
import type { UploadPurpose } from '@/global/storage/types/storage.types';
import {
  FOREIGN_UPLOAD_URL,
  ownedUploadUrl,
  s3TestProviders,
} from '@/test/storage/s3-test.helper';

const ACCOUNT = 7n;
const BASE_IMAGE = 'https://i.example/base.png';
const url = (purpose: UploadPurpose, name: string) =>
  ownedUploadUrl(purpose, ACCOUNT, name);
const keyOf = (u: string) => new URL(u).pathname.slice(1);
const COMPOSITE = url('ORDER_CUSTOM_COMPOSITE', 'composite.png');
const RENDER_KINDS = [
  'THREE_D_TOP',
  'THREE_D_FRONT',
  'THREE_D_BACK',
  'THREE_D_LEFT',
  'THREE_D_RIGHT',
] as const satisfies readonly CustomImageKind[];
const renderUrl = (kind: CustomImageKind) =>
  url('ORDER_CUSTOM_RENDER', `${kind}.png`);

type Template = NonNullable<ProductDetailRow['custom_template']>;
type Token = Template['text_tokens'][number];
type OptionGroup = ProductDetailRow['option_groups'][number];

function token(id: bigint, overrides: Partial<Token> = {}): Token {
  return {
    id,
    token_key: `slot${id}`,
    label: `자리${id}`,
    default_text: '축하해',
    max_length: 20,
    is_required: true,
    pos_x: 1000,
    pos_y: 2000,
    width: 8000,
    height: 1500,
    text_color: '#FF0000',
    text_align: 'LEFT',
    sort_order: Number(id),
    ...overrides,
  };
}

function product(
  mode: CustomMode,
  overrides: Partial<ProductDetailRow> = {},
): ProductDetailRow {
  return {
    id: 1n,
    store_id: 1n,
    name: '케이크',
    description: null,
    purchase_notice: null,
    regular_price: 30000,
    sale_price: null,
    currency: 'KRW',
    preparation_time_minutes: 180,
    custom_mode: mode,
    custom_template: {
      base_image_url: BASE_IMAGE,
      free_edit_enabled: true,
      revision: 3,
      deleted_at: null,
      text_tokens: [token(11n), token(12n, { is_required: false })],
    },
    store: {
      store_name: '매장',
      address_city: null,
      address_neighborhood: null,
      region: null,
    },
    images: [],
    option_groups: [
      group(1n, ['shape.heart', 'shape.circle']),
      group(2n, ['size.mini', 'size.no1']),
      group(3n, ['flavor.cream'], { is_required: false, min_select: 0 }),
    ],
    ...overrides,
  };
}

function group(
  id: bigint,
  keys: string[],
  overrides: Partial<OptionGroup> = {},
): OptionGroup {
  return {
    id,
    name: `그룹${id}`,
    description: null,
    is_active: true,
    is_required: true,
    min_select: 1,
    max_select: 1,
    sort_order: Number(id),
    option_items: keys.map((key, index) => ({
      id: id * 100n + BigInt(index),
      title: key,
      description: null,
      image_url: null,
      price_delta: 0,
      sort_order: index,
      is_active: true,
      three_d_key: key,
    })),
    ...overrides,
  };
}

function template(overrides: Partial<Template>): Partial<ProductDetailRow> {
  return {
    custom_template: { ...product('SLOT').custom_template!, ...overrides },
  };
}

function slotInput(
  overrides: Partial<CreateOrderSlotCustomInput> = {},
): CreateOrderSlotCustomInput {
  return {
    templateRevision: 3,
    texts: [
      { tokenId: '12', valueText: '민지' },
      { tokenId: '11', valueText: '축하해' },
    ],
    compositeImageUrl: COMPOSITE,
    freeEdits: [],
    ...overrides,
  };
}

function freeEdit(
  overrides: Partial<CreateOrderFreeEditInput> = {},
): CreateOrderFreeEditInput {
  return {
    posX: 0,
    posY: 0,
    width: 5000,
    height: 5000,
    descriptionText: '꽃을 그려 주세요',
    referenceImageUrls: [],
    ...overrides,
  };
}

const SELECTED_3D = ['shape.heart', 'size.mini', null];

function threeDInput(
  overrides: Partial<CreateOrderThreeDCustomInput> = {},
): CreateOrderThreeDCustomInput {
  return {
    design: {
      schemaVersion: 1,
      basic: { shape: 'heart', size: 'mini', sheetColor: 'pink' },
      top: [
        {
          kind: 'TEXT',
          x: 0.5,
          y: 0.5,
          size: 8,
          effect: { type: 'none', intensity: 50 },
          text: '생일\r\n축하해 🎂',
          color: '#1d1d1d',
        },
      ],
      side: [
        {
          kind: 'DECO',
          x: 0.1,
          y: 0.4,
          size: 20,
          effect: { type: 'soft', intensity: 0 },
          decoId: 'number-3',
        },
      ],
    },
    renderImages: [...RENDER_KINDS]
      .reverse()
      .map((kind) => ({ kind, imageUrl: renderUrl(kind) })),
    ...overrides,
  };
}

describe('OrderCustomizationService', () => {
  let service: OrderCustomizationService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [...s3TestProviders(), OrderCustomizationService],
    }).compile();
    service = module.get(OrderCustomizationService);
  });

  function resolve(args: {
    product: ProductDetailRow;
    custom?: CreateOrderCustomInput | null;
    quantity?: number;
    selected?: (string | null)[];
  }) {
    return service.resolve({
      product: args.product,
      custom: args.custom,
      quantity: args.quantity ?? 1,
      selectedThreeDKeys: args.selected ?? SELECTED_3D,
      accountId: ACCOUNT,
    });
  }

  const slot = (
    overrides: Partial<CreateOrderSlotCustomInput> = {},
    row: Partial<ProductDetailRow> = {},
  ) =>
    resolve({
      product: product('SLOT', row),
      custom: { slot: slotInput(overrides) },
    });

  describe('방식·수량·준비 상태', () => {
    it.each<
      [CustomMode, string, CreateOrderCustomInput | null | undefined, string]
    >([
      ['NONE', '생략', undefined, '스냅샷 없음'],
      ['NONE', '빈 객체', {}, '스냅샷 없음'],
      ['NONE', '슬롯형', { slot: slotInput() }, 'CUSTOM_INPUT_MISMATCH'],
      ['NONE', '3D', { threeD: threeDInput() }, 'CUSTOM_INPUT_MISMATCH'],
      ['SLOT', '생략', undefined, 'CUSTOM_INPUT_REQUIRED'],
      ['SLOT', 'null', null, 'CUSTOM_INPUT_REQUIRED'],
      [
        'SLOT',
        '둘 다 null',
        { slot: null, threeD: null },
        'CUSTOM_INPUT_REQUIRED',
      ],
      ['SLOT', '3D', { threeD: threeDInput() }, 'CUSTOM_INPUT_MISMATCH'],
      [
        'SLOT',
        '슬롯형 + 3D',
        { slot: slotInput(), threeD: threeDInput() },
        'CUSTOM_INPUT_MISMATCH',
      ],
      ['THREE_D', '빈 객체', {}, 'CUSTOM_INPUT_REQUIRED'],
      // 3D 상품에는 자유 편집이 없다 — 자유 편집은 슬롯형 입력에만 있다
      [
        'THREE_D',
        '자유 편집이 든 슬롯형',
        { slot: slotInput({ freeEdits: [freeEdit()] }) },
        'CUSTOM_INPUT_MISMATCH',
      ],
      [
        'THREE_D',
        '슬롯형 + 3D',
        { slot: slotInput(), threeD: threeDInput() },
        'CUSTOM_INPUT_MISMATCH',
      ],
    ])('%s 상품에 %s 입력이면 %s', (mode, _case, custom, expected) => {
      if (expected === '스냅샷 없음') {
        expect(resolve({ product: product(mode), custom })).toBeNull();
      } else {
        expect(() => resolve({ product: product(mode), custom })).toThrowDomain(
          expected,
        );
      }
    });

    it.each<[CustomMode, CreateOrderCustomInput]>([
      ['SLOT', { slot: slotInput() }],
      ['THREE_D', { threeD: threeDInput() }],
    ])('%s 상품은 수량 1만 받는다', (mode, custom) => {
      expect(() =>
        resolve({ product: product(mode), custom, quantity: 2 }),
      ).toThrowDomain('CUSTOM_QUANTITY_FIXED');
      expect(resolve({ product: product(mode), custom })).not.toBeNull();
    });

    it('커스텀이 없는 상품은 수량을 보지 않는다', () => {
      expect(resolve({ product: product('NONE'), quantity: 5 })).toBeNull();
    });

    it.each<
      [string, CustomMode, Partial<ProductDetailRow>, CreateOrderCustomInput]
    >([
      ['템플릿 없음', 'SLOT', { custom_template: null }, { slot: slotInput() }],
      [
        '삭제된 템플릿',
        'SLOT',
        template({ deleted_at: new Date() }),
        { slot: slotInput() },
      ],
      [
        '문구 자리 0개 + 자유 편집 꺼짐',
        'SLOT',
        template({ text_tokens: [], free_edit_enabled: false }),
        { slot: slotInput({ texts: [] }) },
      ],
      [
        '크기 옵션 그룹 없음',
        'THREE_D',
        { option_groups: [group(1n, ['shape.heart'])] },
        { threeD: threeDInput() },
      ],
    ])(
      '준비가 덜 된 상품(%s)은 CUSTOM_PRODUCT_NOT_READY다',
      (_case, mode, row, custom) => {
        expect(() =>
          resolve({ product: product(mode, row), custom }),
        ).toThrowDomain('CUSTOM_PRODUCT_NOT_READY');
      },
    );
  });

  describe('슬롯형', () => {
    it('문구 자리를 설정 순서대로 스냅샷하고 합성 이미지를 대표 이미지로 둔다', () => {
      const reference = url('ORDER_CUSTOM_REFERENCE', 'ref.png');
      expect(
        slot({
          freeEdits: [
            freeEdit({
              posX: 100,
              descriptionText: '  꽃을\r\n그려 주세요 ',
              referenceImageUrls: [reference],
            }),
          ],
        }),
      ).toEqual({
        mode: 'SLOT',
        baseImageUrl: BASE_IMAGE,
        previewImageUrl: COMPOSITE,
        texts: [
          {
            tokenId: 11n,
            tokenKey: 'slot11',
            label: '자리11',
            defaultText: '축하해',
            valueText: '축하해',
            sortOrder: 11,
            posX: 1000,
            posY: 2000,
            width: 8000,
            height: 1500,
            textColor: '#FF0000',
            textAlign: 'LEFT',
          },
          expect.objectContaining({ tokenId: 12n, valueText: '민지' }),
        ],
        freeEdits: [
          {
            posX: 100,
            posY: 0,
            width: 5000,
            height: 5000,
            descriptionText: '꽃을\n그려 주세요',
            referenceImageUrls: [reference],
          },
        ],
        design: null,
        images: [{ kind: 'SLOT_COMPOSITE', imageUrl: COMPOSITE }],
        uploads: [
          { objectKey: keyOf(COMPOSITE), purpose: 'COMPOSITE' },
          { objectKey: keyOf(reference), purpose: 'REFERENCE' },
        ],
      });
    });

    it('꾸미기 시작 뒤 설정이 바뀌었으면(revision 불일치) CUSTOM_TEMPLATE_CHANGED다', () => {
      for (const templateRevision of [2, 4]) {
        expect(() => slot({ templateRevision })).toThrowDomain(
          'CUSTOM_TEMPLATE_CHANGED',
        );
      }
    });

    it.each<[string, CreateOrderSlotCustomInput['texts']]>([
      ['자리 하나 빠짐', [{ tokenId: '11', valueText: 'a' }]],
      [
        '없는 자리',
        [
          { tokenId: '11', valueText: 'a' },
          { tokenId: '12', valueText: 'b' },
          { tokenId: '13', valueText: 'c' },
        ],
      ],
      [
        '같은 자리 두 번',
        [
          { tokenId: '11', valueText: 'a' },
          { tokenId: '11', valueText: 'b' },
        ],
      ],
      [
        '같은 자리 두 번(표기만 다름)',
        [
          { tokenId: '11', valueText: 'a' },
          { tokenId: ' 11', valueText: 'b' },
        ],
      ],
      [
        '"0"은 없는 자리',
        [
          { tokenId: '11', valueText: 'a' },
          { tokenId: '0', valueText: 'b' },
        ],
      ],
    ])(
      '문구 자리 집합이 다르면(%s) CUSTOM_SLOT_TEXTS_MISMATCH다',
      (_case, texts) => {
        expect(() => slot({ texts })).toThrowDomain(
          'CUSTOM_SLOT_TEXTS_MISMATCH',
        );
      },
    );

    it('빈 tokenId는 INVALID_ID다', () => {
      expect(() =>
        slot({
          texts: [
            { tokenId: '11', valueText: 'a' },
            { tokenId: '', valueText: 'b' },
          ],
        }),
      ).toThrowDomain('INVALID_ID');
    });

    describe('문구 값', () => {
      const valueOf = (
        raw: string | null | undefined,
        overrides: Partial<Token> = {},
      ) =>
        slot(
          { texts: [{ tokenId: '11', valueText: raw }] },
          template({ text_tokens: [token(11n, overrides)] }),
        )!.texts[0].valueText;

      it.each<
        [string, string | null | undefined, Partial<Token>, string | null]
      >([
        ['기본 문구 그대로', '축하해', {}, '축하해'],
        ['CRLF는 LF', '생일\r\n축하해', {}, '생일\n축하해'],
        ['CR만 있어도 LF', '생일\r축하해', {}, '생일\n축하해'],
        ['앞뒤 공백·줄바꿈 제거', '  축하해 \n', {}, '축하해'],
        ['이모지', '🎂🎉', { max_length: 2 }, '🎂🎉'],
        ['합자 이모지는 코드 포인트로 센다(5)', '👨‍👩‍👧', { max_length: 5 }, '👨‍👩‍👧'],
        ['상한 정확히', '가'.repeat(20), {}, '가'.repeat(20)],
        ['CRLF는 LF로 바꾼 뒤 센다', 'a\r\nb', { max_length: 3 }, 'a\nb'],
        ['선택 자리를 지움(null)', null, { is_required: false }, null],
        ['선택 자리를 지움(생략)', undefined, { is_required: false }, null],
        ['선택 자리를 공백·줄바꿈만', ' \r\n ', { is_required: false }, null],
      ])('%s', (_case, raw, overrides, expected) => {
        expect(valueOf(raw, overrides)).toBe(expected);
      });

      it.each<[string, string | null | undefined]>([
        ['null', null],
        ['생략', undefined],
        ['빈 문자열', ''],
        ['공백만', '   '],
      ])('필수 자리를 지우면(%s) CUSTOM_SLOT_TEXT_REQUIRED다', (_case, raw) => {
        expect(() => valueOf(raw)).toThrowDomain('CUSTOM_SLOT_TEXT_REQUIRED');
        expect(() => valueOf(raw)).toThrow("'자리11'에 문구를 넣어 주세요.");
      });

      it.each<[string, string, number]>([
        ['상한 + 1', '가'.repeat(21), 20],
        ['이모지 상한 + 1', '🎂🎉🎈', 2],
        ['합자 이모지(5 코드 포인트)', '👨‍👩‍👧', 4],
      ])('%s는 CUSTOM_SLOT_TEXT_TOO_LONG이다', (_case, raw, max) => {
        expect(() => valueOf(raw, { max_length: max })).toThrowDomain(
          'CUSTOM_SLOT_TEXT_TOO_LONG',
        );
        expect(() => valueOf(raw, { max_length: max })).toThrow(
          `'자리11'에는 ${max}자까지 쓸 수 있어요.`,
        );
      });
    });

    describe('자유 편집', () => {
      const edits = (
        freeEdits: CreateOrderFreeEditInput[] | null | undefined,
        row: Partial<ProductDetailRow> = {},
      ) => slot({ freeEdits }, row)!.freeEdits;
      const rejects = (
        freeEdits: CreateOrderFreeEditInput[],
        field: string,
        row: Partial<ProductDetailRow> = {},
      ) => {
        expect(() => edits(freeEdits, row)).toThrowDomain(
          'CUSTOM_FREE_EDIT_INVALID',
        );
        expect(() => edits(freeEdits, row)).toThrow(`(${field})`);
      };

      it('5건까지 입력 순서대로 받고 생략·null은 없음이다', () => {
        const five = Array.from({ length: 5 }, (_, i) =>
          freeEdit({ descriptionText: `요청${i}` }),
        );
        expect(edits(five).map((e) => e.descriptionText)).toEqual([
          '요청0',
          '요청1',
          '요청2',
          '요청3',
          '요청4',
        ]);
        expect(edits(undefined)).toEqual([]);
        expect(edits(null)).toEqual([]);
      });

      it('6건이면 거절한다', () => {
        rejects(
          Array.from({ length: 6 }, () => freeEdit()),
          'freeEdits',
        );
      });

      it('판매자가 자유 편집을 켜지 않았으면 요청을 받지 않고, 빈 목록은 받는다', () => {
        const off = template({ free_edit_enabled: false });
        rejects([freeEdit()], 'freeEdits', off);
        expect(edits([], off)).toEqual([]);
      });

      it.each<[string, Partial<CreateOrderFreeEditInput>]>([
        ['바탕 전체', { posX: 0, posY: 0, width: 10000, height: 10000 }],
        ['오른쪽 아래 1칸', { posX: 9999, posY: 9999, width: 1, height: 1 }],
      ])('영역 경계 안(%s)은 받는다', (_case, area) => {
        expect(edits([freeEdit(area)])).toHaveLength(1);
      });

      it.each<[string, Partial<CreateOrderFreeEditInput>]>([
        ['x 음수', { posX: -1 }],
        ['y 음수', { posY: -1 }],
        ['너비 0', { width: 0 }],
        ['높이 0', { height: 0 }],
        ['오른쪽 밖', { posX: 5001, width: 5000 }],
        ['아래 밖', { posY: 1, height: 10000 }],
      ])('영역이 바탕 밖이면(%s) 거절한다', (_case, area) => {
        rejects([freeEdit(), freeEdit(area)], 'freeEdits[1]');
      });

      it.each<[string, string, string | null]>([
        ['1자', '가', '가'],
        ['2000자', '가'.repeat(2000), '가'.repeat(2000)],
        [
          'CRLF·앞뒤 공백 정리 뒤 2000자',
          ` ${'가'.repeat(1998)}\r\n가 `,
          `${'가'.repeat(1998)}\n가`,
        ],
        ['빈 문자열', '', null],
        ['공백·줄바꿈만', ' \r\n ', null],
        ['2001자', '가'.repeat(2001), null],
      ])('설명 %s', (_case, descriptionText, expected) => {
        if (expected === null) {
          rejects(
            [freeEdit({ descriptionText })],
            'freeEdits[0].descriptionText',
          );
        } else {
          expect(
            edits([freeEdit({ descriptionText })])[0].descriptionText,
          ).toBe(expected);
        }
      });

      it('참고 사진은 3장까지 받는다', () => {
        const photos = (n: number) =>
          Array.from({ length: n }, (_, i) =>
            url('ORDER_CUSTOM_REFERENCE', `ref${i}.png`),
          );
        expect(
          edits([freeEdit({ referenceImageUrls: photos(3) })])[0]
            .referenceImageUrls,
        ).toEqual(photos(3));
        rejects(
          [freeEdit({ referenceImageUrls: photos(4) })],
          'freeEdits[0].referenceImageUrls',
        );
      });
    });
  });

  describe('3D', () => {
    const threeD = (
      overrides: Partial<CreateOrderThreeDCustomInput> = {},
      selected = SELECTED_3D,
    ) =>
      resolve({
        product: product('THREE_D'),
        custom: { threeD: threeDInput(overrides) },
        selected,
      });

    it('검증한 디자인 JSON v1과 렌더 5장(종류 순)을 저장하고 윗면을 대표 이미지로 둔다', () => {
      const result = threeD();
      expect(result).toMatchObject({
        mode: 'THREE_D',
        baseImageUrl: null,
        previewImageUrl: renderUrl('THREE_D_TOP'),
        texts: [],
        freeEdits: [],
        images: RENDER_KINDS.map((kind) => ({
          kind,
          imageUrl: renderUrl(kind),
        })),
        uploads: RENDER_KINDS.map((kind) => ({
          objectKey: keyOf(renderUrl(kind)),
          purpose: 'RENDER',
        })),
      });
      expect(result!.design).toEqual({
        schemaVersion: 1,
        json: {
          schemaVersion: 1,
          basic: {
            shape: 'heart',
            size: 'mini',
            design: null,
            flavor: null,
            sheetColor: 'pink',
          },
          top: [
            {
              kind: 'TEXT',
              x: 0.5,
              y: 0.5,
              size: 8,
              effect: { type: 'none', intensity: 50 },
              text: '생일\n축하해 🎂',
              color: '#1D1D1D',
            },
          ],
          side: [
            {
              kind: 'DECO',
              x: 0.1,
              y: 0.4,
              size: 20,
              effect: { type: 'soft', intensity: 0 },
              decoId: 'number-3',
            },
          ],
        },
      });
    });

    it.each<[string, (string | null)[]]>([
      ['다른 모양', ['shape.circle', 'size.mini']],
      ['고른 맛이 디자인에 없음', ['shape.heart', 'size.mini', 'flavor.cream']],
      ['모양 미선택', ['size.mini']],
    ])(
      '고른 옵션과 디자인이 다르면(%s) CUSTOM_3D_OPTIONS_CHANGED다',
      (_case, selected) => {
        expect(() => threeD({}, selected)).toThrowDomain(
          'CUSTOM_3D_OPTIONS_CHANGED',
        );
        expect(() => threeD({}, selected)).toThrowDomain(409);
      },
    );

    it('카탈로그·한도를 벗어난 디자인은 CUSTOM_3D_DESIGN_INVALID다', () => {
      const input = threeDInput();
      expect(() =>
        threeD({
          design: {
            ...input.design,
            basic: { ...input.design.basic, sheetColor: 'black' },
          },
        }),
      ).toThrowDomain('CUSTOM_3D_DESIGN_INVALID');
    });

    const renders = (kinds: CustomImageKind[]) =>
      kinds.map((kind, i) => ({
        kind,
        imageUrl: url('ORDER_CUSTOM_RENDER', `r${i}.png`),
      }));

    it.each<[string, CustomImageKind[]]>([
      ['4장(오른쪽 없음)', RENDER_KINDS.slice(0, 4)],
      ['6장(합성 이미지 포함)', [...RENDER_KINDS, 'SLOT_COMPOSITE']],
      ['5장이지만 윗면 2장', [...RENDER_KINDS.slice(0, 4), 'THREE_D_TOP']],
      [
        '5장이지만 오른쪽 대신 합성',
        [...RENDER_KINDS.slice(0, 4), 'SLOT_COMPOSITE'],
      ],
      ['없음', []],
    ])(
      '렌더 이미지가 종류마다 1장씩 5장이 아니면(%s) CUSTOM_RENDER_IMAGES_INVALID다',
      (_case, kinds) => {
        expect(() => threeD({ renderImages: renders(kinds) })).toThrowDomain(
          'CUSTOM_RENDER_IMAGES_INVALID',
        );
      },
    );
  });

  describe('업로드 소유·중복', () => {
    it.each<[string, Partial<CreateOrderSlotCustomInput>]>([
      ['외부 URL', { compositeImageUrl: FOREIGN_UPLOAD_URL }],
      [
        '다른 계정의 업로드',
        {
          compositeImageUrl: ownedUploadUrl(
            'ORDER_CUSTOM_COMPOSITE',
            8n,
            'x.png',
          ),
        },
      ],
      [
        '다른 용도(렌더)를 합성 자리에',
        { compositeImageUrl: url('ORDER_CUSTOM_RENDER', 'x.png') },
      ],
      [
        '다른 계정 경로로 우회(%2e%2e)',
        {
          compositeImageUrl: `https://caquick-media-test.s3.ap-northeast-2.amazonaws.com/order-custom/composites/${ACCOUNT}/%2e%2e/8/x.png`,
        },
      ],
      [
        '다른 용도(합성)를 참고 사진에',
        {
          freeEdits: [
            freeEdit({
              referenceImageUrls: [url('ORDER_CUSTOM_COMPOSITE', 'y.png')],
            }),
          ],
        },
      ],
      [
        '같은 참고 사진 두 번',
        {
          freeEdits: [
            freeEdit({
              referenceImageUrls: [url('ORDER_CUSTOM_REFERENCE', 'r.png')],
            }),
            freeEdit({
              referenceImageUrls: [url('ORDER_CUSTOM_REFERENCE', 'r.png')],
            }),
          ],
        },
      ],
      [
        '쿼리만 다른 같은 파일',
        {
          freeEdits: [
            freeEdit({
              referenceImageUrls: [
                url('ORDER_CUSTOM_REFERENCE', 'r.png'),
                `${url('ORDER_CUSTOM_REFERENCE', 'r.png')}?v=2`,
              ],
            }),
          ],
        },
      ],
    ])('슬롯형: %s는 CUSTOM_UPLOAD_INVALID다', (_case, overrides) => {
      expect(() => slot(overrides)).toThrowDomain('CUSTOM_UPLOAD_INVALID');
    });

    it.each<
      [string, (images: { kind: CustomImageKind; imageUrl: string }[]) => void]
    >([
      [
        '같은 렌더 파일을 두 자세에',
        (images) => {
          images[1].imageUrl = images[0].imageUrl;
        },
      ],
      [
        '다른 용도(참고 사진)를 렌더에',
        (images) => {
          images[0].imageUrl = url('ORDER_CUSTOM_REFERENCE', 'x.png');
        },
      ],
    ])('3D: %s는 CUSTOM_UPLOAD_INVALID다', (_case, tamper) => {
      const input = threeDInput();
      tamper(input.renderImages);
      expect(() =>
        resolve({ product: product('THREE_D'), custom: { threeD: input } }),
      ).toThrowDomain('CUSTOM_UPLOAD_INVALID');
    });
  });
});
