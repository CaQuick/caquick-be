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

  private constructor(message: string, status: number, data: T) {
    this.message = message;
    this.code = status;
    this.data = data;
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
  ): ApiResponseTemplate<null> {
    return new ApiResponseTemplate<null>(message, status, null);
  }

  /**
   * 데이터와 함께 에러 응답을 생성합니다
   */
  static ERROR_WITH_DATA<U>(
    data: U,
    message: string = 'error',
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  ): ApiResponseTemplate<U> {
    return new ApiResponseTemplate<U>(message, status, data);
  }
}
