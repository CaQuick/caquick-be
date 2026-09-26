import { HttpStatus } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

export class ApiResponseTemplate<T> {
  @ApiProperty({ example: 'success' })
  public readonly message: string;

  @ApiProperty({ example: 200 })
  public readonly code: number;

  @ApiProperty({ nullable: true })
  public readonly data: T;

  /** 카탈로그 에러 코드. 성공 응답은 null. */
  @ApiProperty({ nullable: true, example: null })
  public readonly errorCode: string | null;

  private constructor(
    message: string,
    status: number,
    data: T,
    errorCode: string | null = null,
  ) {
    this.message = message;
    this.code = status;
    this.data = data;
    this.errorCode = errorCode;
  }

  static SUCCESS(): ApiResponseTemplate<null> {
    return new ApiResponseTemplate<null>('success', HttpStatus.OK, null);
  }

  static SUCCESS_WITH_DATA<U>(
    data: U,
    message: string = 'success',
    status: HttpStatus = HttpStatus.OK,
  ): ApiResponseTemplate<U> {
    return new ApiResponseTemplate<U>(message, status, data);
  }

  static ERROR(
    message: string = 'error',
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: string | null = null,
  ): ApiResponseTemplate<null> {
    return new ApiResponseTemplate<null>(message, status, null, errorCode);
  }

  static ERROR_WITH_DATA<U>(
    data: U,
    message: string = 'error',
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: string | null = null,
  ): ApiResponseTemplate<U> {
    return new ApiResponseTemplate<U>(message, status, data, errorCode);
  }
}
