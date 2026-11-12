import { describe, expect, it } from '@jest/globals';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CURSOR_MAX_LENGTH, encodeCursor } from '../search-cursor.js';
import { ProductQueryDto } from './product-query.dto.js';

/** The messages of each failing field, as the validation pipe sends them in `errors`. */
async function check(input: Record<string, unknown>, type: new () => object = ProductQueryDto) {
  const dto = plainToInstance(type, input);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return Object.fromEntries(errors.map((error) => [error.property, Object.values(error.constraints ?? {})]));
}

const byName = encodeCursor({ sort: 'name', key: 'Quorin SF 470', sku: 'P-10001' });

describe('ProductQueryDto cursor', () => {
  it('answers 400 to relevance with a cursor, also when relevance is the default with q', async () => {
    const message =
      'cursor does not work with sort relevance (the default when q is set). Set another sort, or use page.';
    expect(await check({ cursor: byName, sort: 'relevance', q: 'soap' })).toEqual({ cursor: [message] });
    expect(await check({ cursor: byName, q: 'soap' })).toEqual({ cursor: [message] });
  });

  it('answers 400 to page with a cursor, a cursor of another sort and a broken cursor', async () => {
    expect(await check({ cursor: byName, page: '1' })).toEqual({
      cursor: ['Send page or cursor, not both.'],
    });
    expect(await check({ cursor: byName, sort: '-name' })).toEqual({
      cursor: ['cursor is for sort name, not -name. Use it with the sort it came from.'],
    });
    expect(await check({ cursor: 'abc' })).toEqual({
      cursor: ['cursor is not valid. Use nextCursor from an earlier answer.'],
    });
    expect(Object.keys(await check({ cursor: 'a'.repeat(CURSOR_MAX_LENGTH + 1) }))).toEqual(['cursor']);
  });

  it('answers 400, not a database error, to a forged cursor whose key has a lone surrogate', async () => {
    const forged = Buffer.from(
      JSON.stringify({ v: 1, sort: 'name', key: 'Quorin\ud800', sku: 'P-1' }),
    ).toString('base64url');
    expect(await check({ cursor: forged })).toEqual({
      cursor: ['cursor is not valid. Use nextCursor from an earlier answer.'],
    });
  });
});

describe('ProductQueryDto repeated keys', () => {
  // The options of the global pipe in configureApp. Express turns ?q=a&q=b into ['a', 'b'].
  // A BadRequestException becomes a 400 problem. Any other error from a validator becomes a 500.
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

  async function rejection(query: Record<string, unknown>, metatype: new () => object = ProductQueryDto) {
    const error = await pipe.transform(query, { type: 'query', metatype }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as { message: string[] };
  }

  it('answers 400 to a repeated q with sort relevance', async () => {
    const { message } = await rejection({ q: ['a', 'b'], sort: 'relevance' });
    expect(message).toContain('q must be a string');
    expect(message).not.toContain('sort relevance needs a search text in q');
  });

  it('answers 400 to a repeated q with a cursor', async () => {
    const { message } = await rejection({ q: ['a', 'b'], cursor: byName, sort: 'name' });
    expect(message).toContain('q must be a string');
    expect((await rejection({ q: ['a', 'b'], cursor: 'abc' })).message).toContain('q must be a string');
  });
});
