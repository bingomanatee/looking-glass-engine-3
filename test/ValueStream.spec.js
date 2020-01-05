/* eslint-disable camelcase,no-shadow */
const tap = require('tap');
const util = require('util');
const p = require('./../package.json');

const { ValueStream } = require('./../lib/index');

function monitorSingle(observable) {
  const result = { errors: [], values: [], done: false };

  result.sub = observable.subscribe((v) => {
    result.values.push(v.value);
  }, (e) => {
    console.log('error keys: ', ...Array.from(Object.keys(e)));
    result.errors.push(e);
  }, () => {
    result.done = true;
  });

  return result;
}

function monitorMulti(observable) {
  const result = { errors: [], values: [], done: false };

  result.sub = observable.subscribe((s) => {
    result.values.push(s.value);
  },
  (e) => {
    result.errors.push(e);
  },
  () => {
    result.done = true;
  });

  return result;
}

function coordFactory() {
  const stream = new ValueStream('coord');
  stream.add('x', 0, 'number')
    .add('y', 0, 'number');

  return stream;
}

tap.test(p.name, (suite) => {
  suite.test('ValueStream', (testValueStream) => {
    testValueStream.test('constructor', (tvsConstructor) => {
      const stream = new ValueStream('Stub');
      tvsConstructor.equal(stream.name, 'Stub');

      testValueStream.test('single value', (tvscSingle) => {
        const single = new ValueStream('SingleNumConstructor', 1, 'number');

        tvscSingle.equal(single.value, 1, 'single value is 1');
        tvscSingle.ok(single.isSingleValue, 'is singleValue');
        tvscSingle.end();
      });
      testValueStream.test('multi value', (tvscMulti) => {
        const multi = new ValueStream('SingleNumConstructor');
        tvscMulti.notOk(multi.isSingleValue);
        tvscMulti.end();
      });

      tvsConstructor.end();
    });

    testValueStream.test('subscription/errors', (tvsSub) => {
      tvsSub.test('single value', (tvsSubSingle) => {
        tvsSubSingle.test('minimal subscription', (tvsMiniSub) => {
          const stream = new ValueStream('num', 1, 'number');

          const result = monitorSingle(stream);
          const {
            errors, values, done,
          } = result;

          tvsMiniSub.same(values, [1], 'values are [1]');
          tvsMiniSub.same(errors, [], 'no errors');
          tvsMiniSub.same(done, false);

          stream.complete();

          tvsMiniSub.same(result.done, true);

          tvsMiniSub.end();
        });

        tvsSubSingle.test('with value change', (tvsValueChange) => {
          const stream = new ValueStream('num', 1, 'number');
          stream._changes.subscribe((change) => {
            console.log('wvc change: ', change);
          });

          const result = monitorSingle(stream);
          stream.set(2);
          stream.set(3);

          const {
            errors, values,
          } = result;

          tvsValueChange.same(values, [1, 2, 3], 'values are [1, 2, 3]');
          tvsValueChange.same(errors, [], 'no errors');
          tvsValueChange.same(result.done, false, 'not done');

          stream.complete();

          tvsValueChange.same(result.done, true, 'done');

          tvsValueChange.end();
        });

        tvsSubSingle.test('with bad value change', (badValue) => {
          const stream = new ValueStream('num', 1, 'number');

          const result = monitorSingle(stream);
          stream.set(2);
          stream.set('nutless monkey');

          const {
            errors, values, done,
          } = result;

          badValue.same(values, [1, 2], 'values are [1, 2]');
          badValue.same(errors, [{
            error: { error: 'wrong type', value: 'nutless monkey', target: 'num' },
            id: 'num',
            name: 'num',
          }], 'has error');
          badValue.same(done, false, 'not done');

          stream.complete();

          badValue.same(result.done, true, 'done');

          badValue.end();
        });

        tvsSubSingle.test('with bad value change can continue', (badValue) => {
          const stream = new ValueStream('num', 1, 'number');

          const result = monitorSingle(stream);
          stream.set(2);
          stream.set('nutless monkey');
          stream.set(3);

          const {
            errors, values,
          } = result;

          badValue.same(values, [1, 2, 3]);
          badValue.same(errors, [{
            error: { error: 'wrong type', value: 'nutless monkey', target: 'num' },
            id: 'num',
            name: 'num',
          }], 'has error');
          badValue.same(result.done, false);

          stream.complete();

          badValue.same(result.done, true, 'done');

          badValue.end();
        });
        tvsSubSingle.end();
      });

      tvsSub.test('multi value', (tbsSubMulti) => {
        tbsSubMulti.test('minimal subscription', (tvsMiniSub) => {
          const stream = coordFactory();

          const result = monitorMulti(stream);
          const {
            errors, values, done,
          } = result;

          tvsMiniSub.same(values, [{ x: 0, y: 0 }], 'has coordinate');
          tvsMiniSub.same(errors, [], 'no errors');
          tvsMiniSub.same(done, false, 'not done');

          stream.complete();

          tvsMiniSub.same(result.done, true, 'done');

          tvsMiniSub.end();
        });

        tbsSubMulti.test('with value change', (tvsValueChange) => {
          const stream = coordFactory();

          const result = monitorMulti(stream);
          stream.set('x', 2);
          stream.set('y', 4);

          const {
            errors, values, done,
          } = result;

          tvsValueChange.same(values, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 4 }], 'has many coordinates');
          tvsValueChange.same(errors, [], 'no errors');
          tvsValueChange.same(done, false, 'not done');

          stream.complete();

          tvsValueChange.same(result.done, true, 'is done');

          tvsValueChange.end();
        });

        tbsSubMulti.test('with bad value change', (badValue) => {
          const stream = coordFactory();

          const result = monitorMulti(stream);
          stream.set('x', 2);
          stream.set('y', 'nutless monkey');

          const {
            errors, values, done,
          } = result;

          badValue.same(values, [{ x: 0, y: 0 }, { x: 2, y: 0 }], 'has coords');
          badValue.same(errors, [{
            error: {
              child: 'y',
              error: {
                error: { error: 'wrong type', value: 'nutless monkey', target: 'coord.y' },
                id: 'coord.y',
                name: 'y',
              },
            },
            id: 'coord',
            name: 'coord',
          }],
          'has error');
          badValue.same(done, false, 'not done');

          stream.complete();

          badValue.same(result.done, true, 'done');

          badValue.test('can continue', (canContinue) => {
            const stream = coordFactory();

            const result = monitorMulti(stream);
            stream.set('x', 2);
            stream.set('y', 'nutless monkey');
            stream.set('x', 3);
            stream.set('y', 4);

            const {
              errors, values, done,
            } = result;

            canContinue.same(values, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }], 'has coords');

            canContinue.same(errors, [{
              error: {
                child: 'y',
                error: {
                  error: { error: 'wrong type', value: 'nutless monkey', target: 'coord.y' },
                  id: 'coord.y',
                  name: 'y',
                },
              },
              id: 'coord',
              name: 'coord',
            }],
            'has error');
            canContinue.same(done, false, 'not done');

            stream.complete();

            canContinue.same(result.done, true, 'done');

            canContinue.end();
          });

          badValue.end();
        });

        tbsSubMulti.end();
      });
      tvsSub.end();
    });

    testValueStream.end();
  });

  suite.end();
});
