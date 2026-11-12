import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReviewDto } from './create-review.dto.js';

async function check(input: Record<string, unknown>) {
  const dto = plainToInstance(CreateReviewDto, input);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, fields: errors.map((e) => e.property).sort() };
}

const valid = { rating: 4, title: 'Works well', body: 'Good emulsifier for our process.', authorName: 'Ana' };

describe('CreateReviewDto', () => {
  it('accepts a valid review', async () => {
    expect((await check(valid)).fields).toEqual([]);
  });

  it('rejects a rating outside 1..5 or not an integer', async () => {
    expect((await check({ ...valid, rating: 0 })).fields).toEqual(['rating']);
    expect((await check({ ...valid, rating: 6 })).fields).toEqual(['rating']);
    expect((await check({ ...valid, rating: 3.5 })).fields).toEqual(['rating']);
    expect((await check({ ...valid, rating: '4' })).fields).toEqual(['rating']);
  });

  it('requires rating, body and authorName', async () => {
    expect((await check({})).fields).toEqual(['authorName', 'body', 'rating']);
  });

  it('checks body length 10..2000 after trimming', async () => {
    expect((await check({ ...valid, body: '   short    ' })).fields).toEqual(['body']);
    expect((await check({ ...valid, body: 'x'.repeat(2001) })).fields).toEqual(['body']);
    expect((await check({ ...valid, body: 'x'.repeat(2000) })).fields).toEqual([]);
  });

  it('checks author name length 2..60 after trimming', async () => {
    expect((await check({ ...valid, authorName: ' A ' })).fields).toEqual(['authorName']);
    expect((await check({ ...valid, authorName: 'x'.repeat(61) })).fields).toEqual(['authorName']);
  });

  it('checks title length at most 120', async () => {
    expect((await check({ ...valid, title: 'x'.repeat(121) })).fields).toEqual(['title']);
  });

  it('counts code points like the varchar limits in the database', async () => {
    const heart = '❤️'; // two code points
    expect((await check({ ...valid, authorName: heart.repeat(30) })).fields).toEqual([]);
    expect((await check({ ...valid, authorName: heart.repeat(31) })).fields).toEqual(['authorName']);
    expect((await check({ ...valid, title: heart.repeat(61) })).fields).toEqual(['title']);
    expect((await check({ ...valid, body: heart.repeat(1001) })).fields).toEqual(['body']);
    // One code point each, so five emoji are too short for the body.
    expect((await check({ ...valid, body: '😀'.repeat(5) })).fields).toEqual(['body']);
  });

  it('rejects control characters but keeps tabs and line breaks', async () => {
    expect((await check({ ...valid, body: 'Good product\u0000 here' })).fields).toEqual(['body']);
    expect((await check({ ...valid, authorName: 'A\u0007na' })).fields).toEqual(['authorName']);
    expect((await check({ ...valid, title: 'T\u001bitle' })).fields).toEqual(['title']);
    expect((await check({ ...valid, body: 'Line one\nLine two\r\n\tok' })).fields).toEqual([]);
  });

  it('trims strings', async () => {
    const { dto } = await check({ ...valid, authorName: '  Ana  ', body: '  Good emulsifier here.  ' });
    expect(dto.authorName).toBe('Ana');
    expect(dto.body).toBe('Good emulsifier here.');
  });
});
