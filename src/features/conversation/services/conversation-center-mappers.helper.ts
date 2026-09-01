/** DI-free 순수 함수만 둔다 — 대화 목록 미리보기 텍스트 가공. */

/**
 * HTML 본문 → 목록 미리보기 plain text.
 * 표시용 한 줄 미리보기가 목적이라 완전한 HTML 파싱 대신 태그 제거 +
 * 공백 정리로 충분하다(저장 원문은 그대로 유지).
 */
export function stripHtmlToPreview(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 마지막 메시지 row → 미리보기 텍스트. TEXT는 원문, HTML은 태그 제거. */
export function toLastMessagePreview(
  message: {
    body_format: 'TEXT' | 'HTML';
    body_text: string | null;
    body_html: string | null;
  } | null,
): string | null {
  if (!message) return null;
  if (message.body_format === 'HTML') {
    return message.body_html ? stripHtmlToPreview(message.body_html) : null;
  }
  return message.body_text;
}
