import { CustomMode } from '@/generated/prisma/client';

export type ProductCustomIssueCode =
  'SLOT_TEMPLATE_MISSING' | 'SLOT_NOTHING_TO_EDIT' | 'THREE_D_GROUP_MISSING';

export interface ProductCustomIssue {
  code: ProductCustomIssueCode;
  message: string;
  optionGroupId: string | null;
}

/** 준비 상태 판정에 필요한 만큼만 받는다. text_tokens는 삭제 제외 목록이어야 한다. */
export interface ProductCustomReadinessSource {
  custom_template: {
    deleted_at: Date | null;
    free_edit_enabled: boolean;
    text_tokens: readonly unknown[];
  } | null;
}

const ISSUE_MESSAGES: Record<ProductCustomIssueCode, string> = {
  SLOT_TEMPLATE_MISSING: '바탕 이미지를 먼저 등록해 주세요.',
  SLOT_NOTHING_TO_EDIT: '문구 자리를 추가하거나 자유 편집을 허용해 주세요.',
  THREE_D_GROUP_MISSING: '모양·크기 옵션을 3D 항목과 연결해 주세요.',
};

const issue = (code: ProductCustomIssueCode): ProductCustomIssue => ({
  code,
  message: ISSUE_MESSAGES[code],
  optionGroupId: null,
});

/** 판매자 방식 변경·준비 상태 경고·주문 생성이 같은 판정을 쓴다. 빈 배열이면 그 방식으로 주문을 받을 수 있다. */
export function evaluateProductCustomIssues(
  row: ProductCustomReadinessSource,
  mode: CustomMode,
): ProductCustomIssue[] {
  switch (mode) {
    case CustomMode.NONE:
      return [];
    case CustomMode.SLOT: {
      const template =
        row.custom_template?.deleted_at === null ? row.custom_template : null;
      if (!template) return [issue('SLOT_TEMPLATE_MISSING')];
      return template.text_tokens.length === 0 && !template.free_edit_enabled
        ? [issue('SLOT_NOTHING_TO_EDIT')]
        : [];
    }
    case CustomMode.THREE_D:
      // 옵션 항목을 3D 카탈로그에 연결하는 칸이 아직 없어 모양·크기 그룹을 만들 수 없다
      return [issue('THREE_D_GROUP_MISSING')];
  }
}
