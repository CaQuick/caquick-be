import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpsertProductCustomTextTokenInput } from '@/features/product/dto/inputs/seller-upsert-product-custom-text-token.input';

function build(plain: object): SellerUpsertProductCustomTextTokenInput {
  return plainToInstance(SellerUpsertProductCustomTextTokenInput, plain);
}

const REQUIRED = {
  templateId: '1',
  tokenKey: 'name',
  defaultText: '홍길동',
  posX: 0,
  posY: 0,
  width: 100,
  height: 50,
};

describe('SellerUpsertProductCustomTextTokenInput', () => {
  it('필수만 통과 (신규)', async () => {
    expect(await validate(build(REQUIRED))).toHaveLength(0);
  });

  it('전체 필드 통과 (수정)', async () => {
    const dto = build({
      ...REQUIRED,
      tokenId: '5',
      label: '받는 사람',
      maxLength: 30,
      sortOrder: 0,
      isRequired: true,
      textColor: '#FF0000',
      textAlign: 'LEFT',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('표시 이름·글자색·정렬의 명시적 null은 생략과 같다', async () => {
    const dto = build({
      ...REQUIRED,
      label: null,
      textColor: null,
      textAlign: null,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['tokenKey', 'defaultText', 'posX', 'posY', 'width', 'height'])(
    '%s 누락 거절',
    async (field) => {
      const plain: Record<string, unknown> = { ...REQUIRED };
      delete plain[field];
      const errors = await validate(build(plain));
      expect(errors.map((e) => e.property)).toEqual([field]);
    },
  );

  it('정렬은 LEFT·CENTER·RIGHT만 받는다', async () => {
    const errors = await validate(build({ ...REQUIRED, textAlign: 'JUSTIFY' }));
    expect(errors.map((e) => e.property)).toEqual(['textAlign']);
  });

  // 범위·형식은 도메인 오류 코드를 내도록 service가 검사한다
  it('최대 글자 수·좌표 범위는 DTO에서 막지 않는다', async () => {
    const dto = build({ ...REQUIRED, maxLength: 0, posX: -1, width: 0 });
    expect(await validate(dto)).toHaveLength(0);
  });
});
