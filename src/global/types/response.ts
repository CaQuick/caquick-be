import { HttpStatus } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

/**
 * API 응답 템플릿
 */
export class ApiResponseTemplate<T> {
  /**
   * 메시지 (예: 'success', 'error')
   */
  @ApiProperty({ example: 'success' })
  public readonly message: string;

  /**
   * HTTP 상태 코드(숫자)
   */
  @ApiProperty({ example: 200 })
  public readonly code: number;

  /**
   * 응답 데이터 페이로드
   */
  @ApiProperty({ nullable: true })
  public readonly data: T;

  /**
   * 도메인 에러 코드(ERROR_CATALOG). 카탈로그를 거친 예외에만 실린다.
   *
   * `code`는 HTTP 상태 숫자라 도메인 식별자를 담을 수 없어 필드를 따로 둔다.
   * GraphQL 쪽 `extensions.errorCode`와 같은 이름·같은 값이다 — 클라이언트가
   * transport에 상관없이 같은 분기를 쓴다.
   */
  @ApiProperty({ required: false, example: 'INVALID_CREDENTIALS' })
  public readonly errorCode?: string;

  private constructor(
    message: string,
    status: number,
    data: T,
    errorCode?: string,
  ) {
    this.message = message;
    this.code = status;
    this.data = data;
    // undefined면 JSON 직렬화에서 빠진다 — 성공 응답에 빈 필드를 남기지 않는다
    if (errorCode !== undefined) this.errorCode = errorCode;
  }

  /**
   * 성공 응답을 생성합니다 (데이터 없음)
   */
  static SUCCESS(): ApiResponseTemplate<null> {
    return new ApiResponseTemplate<null>('success', HttpStatus.OK, null);
  }

  /**
   * 데이터와 함께 성공 응답을 생성합니다
   */
  static SUCCESS_WITH_DATA<U>(
    data: U,
    message: string = 'success',
    status: HttpStatus = HttpStatus.OK,
  ): ApiResponseTemplate<U> {
    return new ApiResponseTemplate<U>(message, status, data);
  }

  /**
   * 에러 응답을 생성합니다 (데이터 없음)
   */
  static ERROR(
    message: string = 'error',
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode?: string,
  ): ApiResponseTemplate<null> {
    return new ApiResponseTemplate<null>(message, status, null, errorCode);
  }

  /**
   * 데이터와 함께 에러 응답을 생성합니다
   */
  static ERROR_WITH_DATA<U>(
    data: U,
    message: string = 'error',
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode?: string,
  ): ApiResponseTemplate<U> {
    return new ApiResponseTemplate<U>(message, status, data, errorCode);
  }
}
