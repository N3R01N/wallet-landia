import { describe, expect, it } from 'vitest';
import { roomRemark } from '../src/world/roomTalk.js';
import type { Room, RoomObject } from '../src/world/roomLayout.js';

const obj = (kind: RoomObject['kind'], extra: Partial<RoomObject> = {}): RoomObject => ({ id: kind, kind, zone: 'floor', x: 0.5, y: 0.5, size: 0.5, label: kind, usd: null, ...extra });
const room = (objects: RoomObject[]): Room => ({ title: 'x', empty: objects.length === 0, objects, morePictures: 0, moreTokens: 0 });

describe('what the villager says in a house', () => {
  it('an empty house has nothing to say about itself', () => {
    expect(roomRemark(room([]))).toBe('nothing here, ser');
  });
  it('a loan in danger brings the bailiffs; a healthy loan does not', () => {
    expect(roomRemark(room([obj('scale', { tone: 'danger' })]))).toBe('the bailiffs are at the door');
    expect(roomRemark(room([obj('scale', { tone: 'safe' })]))).not.toBe('the bailiffs are at the door');
  });
  it('rewards waiting are claimed; a bag-heavy house jokes about it', () => {
    expect(roomRemark(room([obj('harvest')]))).toBe('rewards to claim!');
    expect(roomRemark(room([obj('coins'), obj('sack'), obj('chest')]))).toBe('bags are heavy');
  });
});
