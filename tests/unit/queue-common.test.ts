// Queue client helpers shared by the pages and adapters: nickname rules, queue sorting, QueueError.
import { describe, expect, it } from 'vitest';
import { cleanNickname, NICKNAME_MAX } from '../../shared/queue/nickname.ts';
import { aheadOf, QueueError, sortQueue } from '../../shared/queue/common.ts';
import type { Status, Ticket } from '../../shared/queue/types.ts';

describe('cleanNickname', () => {
  it('trims and collapses spaces', () => expect(cleanNickname('  そら   とぶ  ')).toBe('そら とぶ'));
  it('drops HTML-ish symbols', () => expect(cleanNickname('<b>ネコ</b>&"\'`')).toBe('bネコ/b'));
  it('drops control, zero-width and bidi characters', () => expect(cleanNickname('a\u0000b​c‮d﻿e\u0085f')).toBe('abcdef'));
  it(`keeps at most ${NICKNAME_MAX} characters, counting emoji as one`, () => {
    expect([...cleanNickname('🚀'.repeat(20))].length).toBe(NICKNAME_MAX);
    expect(cleanNickname('あいうえおかきくけこさしす')).toBe('あいうえおかきくけこさし');
  });
  it('normalizes to NFC', () => expect(cleanNickname('パ')).toBe('パ'));
  it.each([undefined, null, 12, {}])('non-strings → empty (%j)', (v) => expect(cleanNickname(v)).toBe(''));
});

const t = (number: number, status: Status): Ticket => ({ id: `t${number}`, number, nickname: `n${number}`, status, createdAt: 0, updatedAt: 0, checkedInAt: null });

describe('sortQueue / aheadOf', () => {
  const q = sortQueue([t(4, 'waiting'), t(2, 'playing'), t(1, 'done'), t(3, 'waiting'), t(5, 'cancelled'), t(6, 'waiting')]);
  it('serving is the called / playing ticket; waiting ascending; finished ones left out', () => {
    expect(q.serving?.number).toBe(2);
    expect(q.waiting.map((x) => x.number)).toEqual([3, 4, 6]);
  });
  it('counts waiting tickets in front', () => {
    expect(aheadOf(t(6, 'waiting'), q)).toBe(2);
    expect(aheadOf(t(3, 'waiting'), q)).toBe(0);
    expect(aheadOf(t(2, 'playing'), q)).toBe(0);
    expect(aheadOf(null, q)).toBe(0);
  });
});

describe('QueueError', () => {
  it('keeps known codes and the cause', () => {
    const cause = new Error('x');
    const e = new QueueError('not-found', 'gone', cause);
    expect([e.code, e.message, e.cause, e.name]).toEqual(['not-found', 'gone', cause, 'QueueError']);
  });
  it('unknown codes become unavailable', () => expect(new QueueError('weird').code).toBe('unavailable'));
});
