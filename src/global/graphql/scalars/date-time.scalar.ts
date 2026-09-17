import { Scalar } from '@nestjs/graphql';
import type { CustomScalar } from '@nestjs/graphql';
import { Kind } from 'graphql';
import type { ValueNode } from 'graphql';

@Scalar('DateTime', () => Date)
export class DateTimeScalar implements CustomScalar<string, Date> {
  parseValue(value: unknown): Date {
    if (typeof value !== 'string') {
      throw new TypeError('Invalid DateTime value.');
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new TypeError('Invalid DateTime value.');
    }
    return date;
  }

  serialize(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new TypeError('Invalid DateTime value.');
      }
      return parsed.toISOString();
    }
    throw new TypeError('Invalid DateTime value.');
  }

  parseLiteral(ast: ValueNode): Date {
    if (ast.kind !== Kind.STRING) {
      throw new TypeError('Invalid DateTime literal.');
    }
    return this.parseValue(ast.value);
  }
}
