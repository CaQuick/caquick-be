/** 표시용 한 줄 미리보기라 완전한 HTML 파싱 대신 태그 제거 + 공백 정리로 충분하다(저장 원문은 그대로). */
export function stripHtmlToPreview(html: string): string {
  return (
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      // &amp; 복원은 반드시 마지막 — 먼저 풀면 "&amp;lt;" 같은 이중
      // 이스케이프가 두 번 풀려 "<"가 된다 (CodeQL js/double-escaping)
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

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
