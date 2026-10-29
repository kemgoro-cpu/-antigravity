'use strict';
const assert = require('node:assert/strict');
const A = require('../analysis-utils.js');
// An explicitly selected range must not silently follow an unrelated view zoom.
const choice = {scope:'selection',range:[10,30],rawTime:false,mainName:'基準_ﾛｸﾞ.csv'};
assert.deepEqual(A.resolve(choice,[40,50],[0,60]).range,[10,30]);
assert.deepEqual(A.resolve({...choice,scope:'visible'},[40,50],[0,60]).range,[40,50]);
assert.deepEqual(A.resolve({...choice,scope:'all'},[40,50],[0,60]).range,[0,60]);
assert.equal(A.resolve({scope:'selection'},[40,50],[0,60]).range,null);
assert.equal(A.offset({role:'sub',offset:-2},true),0);
assert.equal(A.offset({role:'sub',offset:-2},false),-2);
assert.equal(A.resolve({...choice,rawTime:true},null,[0,60]).timeLabel,'元の時刻');
const copied=A.clean(choice);copied.range[0]=0;assert.equal(choice.range[0],10);
assert.deepEqual(A.clean({scope:'bad',range:[NaN,4],rawTime:'true'}),{scope:'visible',range:null,rawTime:false,mainName:''});
assert.equal(A.clean({range:[30,10]}).range,null);
assert.deepEqual(A.clean({range:[10,10]}).range,[10,10]);
// Full scope includes interior extremes even if the log reverses in time.
const reversed = { timeData: new Float64Array([0, 9, -2, 0]), headerInfo: {timeScale:1} };
assert.deepEqual(A.extent(reversed), [-2,9]);
const detached = A.extent(reversed); detached[0] = -99;
assert.deepEqual(A.extent(reversed), [-2,9]);
// Manual time-unit confirmation rescales the same typed array in place.
reversed.timeData.forEach((v,i) => { reversed.timeData[i] = v / 1000; });
reversed.headerInfo.timeScale = .001;
assert.deepEqual(A.extent(reversed), [-.002,.009]);
assert.equal(A.extent({timeData:[NaN,Infinity]}),null);
console.log('analysis-utils tests passed (scope, original/aligned time, validation, immutable ranges)');
