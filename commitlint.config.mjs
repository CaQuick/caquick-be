export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 한국어 커밋 메시지를 허용하기 위해 subject 대소문자 규칙 비활성화
    'subject-case': [0],
    // 본문 최대 줄 길이 완화 (Co-Authored-By 등 긴 줄 허용)
    'body-max-line-length': [0],
    // footer 최대 줄 길이 완화
    'footer-max-line-length': [0],
    // 본문에 #anchor 같은 URL fragment를 인용하면 conventional-commits 파서가
    // 이를 이슈 참조(#123)로 오인해 그 줄부터를 footer로 분류한다. 그 결과
    // "footer 앞에 빈 줄이 없다"는 false positive 경고가 뜸. README/URL 인용을
    // 본문에 자유롭게 쓰기 위해 비활성.
    'footer-leading-blank': [0],
  },
};
