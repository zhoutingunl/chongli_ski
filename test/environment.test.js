import assert from 'node:assert/strict';
import test from 'node:test';
import {createMountainClimate, DAY_CYCLE_SECONDS, WEATHER_CYCLE_SECONDS} from '../src/environment.js';

test('固定白天时天气仍会变化，下雪增大雾密度并减弱直射光', () => {
  const climate = createMountainClimate();
  const clear = climate.sample('day', 'clear', 0);
  const storm = climate.sample('day', 'heavy', DAY_CYCLE_SECONDS / 2);
  assert.equal(clear.clock, storm.clock);
  assert.equal(clear.snowAmount, 0);
  assert.ok(storm.snowAmount > clear.snowAmount);
  assert.ok(storm.density > clear.density && storm.sunAmount < clear.sunAmount);
});

test('自动时钟和自动降雪各自按游戏时间循环', () => {
  const climate = createMountainClimate();
  const time = 110;
  const start = climate.sample('auto', 'auto', time);
  const nextDay = climate.sample('auto', 'auto', time + DAY_CYCLE_SECONDS);
  assert.equal(nextDay.clock, start.clock);
  const nextWeather = climate.sample('auto', 'auto', time + WEATHER_CYCLE_SECONDS);
  assert.equal(nextWeather.snowAmount, start.snowAmount);
  assert.notEqual(nextWeather.clock, start.clock);
  assert.notEqual(climate.sample('auto', 'auto', 0).snowAmount, start.snowAmount);
});

test('无法识别的时段、天气和无效计时会回退到初始环境', () => {
  const climate = createMountainClimate();
  const expected = climate.sample('auto', 'auto', 0);
  for (const elapsed of [-5, NaN, Infinity]) {
    assert.deepEqual(climate.sample('unknown-time', 'unknown-weather', elapsed), expected);
  }
});
