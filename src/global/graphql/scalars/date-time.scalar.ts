import { Scalar } from '@nestjs/graphql';
import type { CustomScalar } from '@nestjs/graphql';
import { Kind } from 'graphql';
import type { ValueNode } from 'graphql';

/**
 * ISO DateTime 스칼라
 */
@Scalar('DateTime', () => Date)
export class DateTimeScalar implements CustomScalar<string, Date> {
  /**
   * 클라이언트 입력 값을 Date로 변환한다.
   */
  parseValue(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new TypeError('Invalid DateTime value.');
    }
    return date;
  }

  /**
   * 내부 값을 ISO 문자열로 직렬화한다.
   */
  serialize(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return value;
    }
    throw new TypeError('Invalid DateTime value.');
  }

  /**
   * GraphQL AST 리터럴 파싱
   */
  parseLiteral(ast: ValueNode): Date {
    if (ast.kind !== Kind.STRING) {
      throw new TypeError('Invalid DateTime literal.');
    }
    return this.parseValue(ast.value);
  }
}
