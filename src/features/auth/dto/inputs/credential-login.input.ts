import { IsString, Length } from 'class-validator';

/** 실제 인증은 argon2.verify가 담당하므로 형식만 검증한다 — 로그인 시점에는 복잡도 정책을 적용하지 않는다(등록 시점 정책만 신뢰). */
export class CredentialLoginInput {
  @IsString()
  @Length(4, 80)
  username!: string;

  @IsString()
  @Length(8, 64)
  password!: string;
}
