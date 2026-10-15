import { describe, expect, it } from 'vitest';
import { lightAt, nightFactor, weatherFor } from '../src/castle/world/sky.js';

describe('castle sky', () => {
  it('day at noon, night at midnight, dusk between', () => {
    expect(nightFactor(13)).toBe(0);
    expect(nightFactor(0)).toBe(1);
    expect(nightFactor(19.5)).toBeGreaterThan(0);
    expect(nightFactor(19.5)).toBeLessThan(1);
  });

  it('the night is darker and the windows glow brighter', () => {
    const day = lightAt(12);
    const night = lightAt(23);
    expect(night.sun).toBeLessThan(day.sun);
    expect(night.ambient).toBeLessThan(day.ambient);
    expect(night.glow).toBeGreaterThan(day.glow);
    expect(day.sky).toBe(0xbcd3e0);
  });

  it('a falling market rains, a crash pours, a rising one is clear', () => {
    expect(weatherFor('crash').rain).toBe(1);
    expect(weatherFor('down').rain).toBeGreaterThan(0);
    expect(weatherFor('down').rain).toBeLessThan(1);
    expect(weatherFor('up')).toMatchObject({ rain: 0, gloom: 0 });
    // every mood shows: a rise is sunnier and clearer than flat, a fall cloudier
    expect(weatherFor('boom').clouds).toBeLessThan(weatherFor('up').clouds);
    expect(weatherFor('up').clouds).toBeLessThan(weatherFor(null).clouds);
    expect(weatherFor(null).clouds).toBeLessThan(weatherFor('down').clouds);
    expect(weatherFor('boom').shine).toBeGreaterThan(weatherFor(null).shine);
  });
});
