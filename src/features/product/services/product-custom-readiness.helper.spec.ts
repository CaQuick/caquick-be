import {
  evaluateProductCustomIssues,
  type ProductCustomReadinessSource,
} from '@/features/product/services/product-custom-readiness.helper';
import { CustomMode } from '@/generated/prisma/client';

const template = (
  slots: number,
  freeEdit: boolean,
  deleted = false,
): ProductCustomReadinessSource['custom_template'] => ({
  deleted_at: deleted ? new Date() : null,
  free_edit_enabled: freeEdit,
  text_tokens: Array.from({ length: slots }, (_, i) => ({ id: i })),
});

describe('evaluateProductCustomIssues', () => {
  it.each([
    ['NONE', '템플릿 없음', null, []],
    ['NONE', '빈 템플릿', template(0, false), []],
    ['SLOT', '템플릿 없음', null, ['SLOT_TEMPLATE_MISSING']],
    [
      'SLOT',
      '삭제된 템플릿',
      template(2, true, true),
      ['SLOT_TEMPLATE_MISSING'],
    ],
    [
      'SLOT',
      '문구 자리 0·자유 편집 끔',
      template(0, false),
      ['SLOT_NOTHING_TO_EDIT'],
    ],
    ['SLOT', '문구 자리 0·자유 편집 켬', template(0, true), []],
    ['SLOT', '문구 자리 1·자유 편집 끔', template(1, false), []],
    ['THREE_D', '템플릿 없음', null, ['THREE_D_GROUP_MISSING']],
    [
      'THREE_D',
      '문구 자리 있는 템플릿',
      template(1, true),
      ['THREE_D_GROUP_MISSING'],
    ],
  ] as const)('%s · %s → %j', (mode, _label, customTemplate, codes) => {
    const issues = evaluateProductCustomIssues(
      { custom_template: customTemplate },
      mode,
    );
    expect(issues.map((i) => i.code)).toEqual(codes);
    for (const issue of issues) {
      expect(issue.message).toMatch(/[가-힣]/);
      expect(issue.optionGroupId).toBeNull();
    }
  });

  it('표가 모든 커스텀 방식을 덮는다', () => {
    expect(Object.values(CustomMode)).toEqual(['NONE', 'SLOT', 'THREE_D']);
  });
});
