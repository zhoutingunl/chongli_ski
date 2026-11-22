import test from 'node:test';
import assert from 'node:assert/strict';
import {challengeBoard,challengeScore,mergeSkiProgress,weekStart} from '../src/ski-engagement.js';

test('周榜以北京时间周一换周，四种装备和循线组合分榜，越快分越高',()=>{
  const midnight=Date.parse('2026-11-23T00:00:00+08:00');
  assert.equal(weekStart(midnight),midnight);
  assert.equal(weekStart(midnight-1),midnight-7*86400000);
  assert.deepEqual(['ski','board'].flatMap(gear=>[true,false].map(assist=>challengeBoard({gear,assist}))),[1,2,3,4]);
  assert.ok(challengeScore(46.983)>challengeScore(47.251));
});

test('跨设备合并雪道不丢进度，重复滑行去重，每周同组保留最佳成绩',()=>{
  const run={routeId:'wanlong-piste-7',when:'2026-11-22T00:00:00.000Z'};
  const result=mergeSkiProgress({pistes:['wanlong/金龙道'],records:[run],weekly:[{week:100,board:1,seconds:42}]},[
    {pistes:['wanlong/玉龙道','wanlong/金龙道'],records:[run],weekly:[{week:100,board:1,seconds:41},{week:100,board:2,seconds:38}]}
  ]);
  assert.equal(result.pistes.length,2);
  assert.deepEqual(result.records,[run]);
  assert.deepEqual(result.weekly.map(entry=>entry.seconds),[41,38]);
});
