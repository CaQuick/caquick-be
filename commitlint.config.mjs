export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 한국어 커밋 메시지를 허용하기 위해 subject 대소문자 규칙 비활성화
    'subject-case': [0],
    // 본문 최대 줄 길이 완화 (Co-Authored-By 등 긴 줄 허용)
    'body-max-line-length': [0],
    // footer 최대 줄 길이 완화
    'footer-max-line-length': [0],
  },
};
