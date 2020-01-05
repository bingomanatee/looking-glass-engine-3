/* eslint-disable camelcase,no-shadow */
const tap = require('tap');
const is = require('is');
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
  let nextId = 1000;
  stream.property('x', 0, 'number')
    .property('y', 0, 'number')
    .method('negate', (stream) => {
      stream.do.setX(-stream.get('x'));
      stream.do.setY(-stream.get('y'));
    })
    .property('saved', false, 'boolean')
    .method('post', (stream) => new Promise((done, fail) => {
      stream.do.setSaved(false);
      setTimeout(() => {
        if (!(stream.get('y') || stream.get('x'))) {
          fail({
            saved: false,
            x: stream.get('x'),
            y: stream.get('y'),
            message: 'x or y must be non-zero',
          });
        } else {
          stream.do.setSaved(true);
          done({
            saved: true, x: stream.get('x'), y: stream.get('y'), id: nextId,
          });
          nextId += 1;
        }
      }, 150);
    }))
    .method('add', (stream, x, y) => {
      if (!is.number(x)) {
        stream.emitError({ method: 'add', message: `non-numeric x: ${x}` });
        return;
      }
      if (!is.number(y)) {
        stream.emitError({ method: 'add', message: `non-numeric y: ${x}` });
        return;
      }
      stream.do.setX(x + stream.get('x'));
      stream.do.setY(y + stream.get('y'));
    });

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

          badValue.same(errors, [{ error: { message: 'wrong type', value: 'nutless monkey' }, id: 'num', name: 'num' }],
            'has error');
          badValue.same(done, false, 'not done');

          stream.complete();

          badValue.same(result.done, true, 'done');

          badValue.end();
        });

        tvsSubSingle.test('with bad value change can continue', (bvContinue) => {
          const stream = new ValueStream('num', 1, 'number');

          const result = monitorSingle(stream);
          stream.set(2);
          stream.set('nutless monkey');
          stream.set(3);

          const {
            errors, values,
          } = result;

          bvContinue.same(values, [1, 2, 3]);
          bvContinue.same(errors,
            [{ error: { message: 'wrong type', value: 'nutless monkey' }, id: 'num', name: 'num' }],
            'has error');
          bvContinue.same(result.done, false);

          stream.complete();

          bvContinue.same(result.done, true, 'done');

          bvContinue.end();
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

          tvsMiniSub.same(values, [{ x: 0, y: 0, saved: false }], 'has coordinate');
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

          tvsValueChange.same(values, [
            { x: 0, y: 0, saved: false },
            { x: 2, y: 0, saved: false },
            { x: 2, y: 4, saved: false }], 'has many coordinates');
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

          badValue.same(values, [
            { x: 0, y: 0, saved: false },
            { x: 2, y: 0, saved: false },
          ], 'has coords');
          badValue.same(errors, [{
            error: {
              error: { message: 'wrong type', value: 'nutless monkey' },
              id: 'coord.y',
              name: 'y',
              source: 'y',
              target: 'coord',
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

            canContinue.same(values, [
              { x: 0, y: 0, saved: false },
              { x: 2, y: 0, saved: false },
              { x: 3, y: 0, saved: false },
              { x: 3, y: 4, saved: false }], 'has coords');

            canContinue.same(errors, [{
              error: {
                error: { message: 'wrong type', value: 'nutless monkey' },
                id: 'coord.y',
                name: 'y',
                source: 'y',
                target: 'coord',
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

    testValueStream.test('methods', (tvsMethods) => {
      tvsMethods.test('simple, synchronous', (tvsMethodsSimple) => {
        const stream = coordFactory();
        tvsMethodsSimple.same(stream.get('x'), 0, 'x is 0');
        tvsMethodsSimple.same(stream.get('y'), 0, 'y is 0');

        stream.do.add(2, -4);
        tvsMethodsSimple.same(stream.get('x'), 2, 'x is 2');
        tvsMethodsSimple.same(stream.get('y'), -4, 'y is -4');

        stream.do.negate();
        tvsMethodsSimple.same(stream.get('x'), -2, 'x is -2');
        tvsMethodsSimple.same(stream.get('y'), 4, 'y is 4');
        tvsMethodsSimple.end();
      });

      tvsMethods.test('async', async (tvtMethodAsync) => {
        const stream = coordFactory();
        stream.do.add(100, 300);
        const result = await stream.do.post();

        tvtMethodAsync.same(result, {
          saved: true, x: 100, y: 300, id: 1000,
        }, 'saved with id');
        tvtMethodAsync.same(stream.get('x'), 100, 'x is 100');
        tvtMethodAsync.same(stream.get('y'), 300, 'y is 300');
        tvtMethodAsync.same(stream.get('saved'), true, 'saved is true');

        tvtMethodAsync.end();
      });

      tvsMethods.test('async error', async (tvsAsyncError) => {
        const stream = coordFactory();
        const monitor = monitorMulti(stream);
        const result = await stream.do.post();


        tvsAsyncError.same(result, {
          error: {
            saved: false, x: 0, y: 0, message: 'x or y must be non-zero',
          },
        },
        'saved with id');
        tvsAsyncError.same(stream.get('x'), 0, 'x is 0');
        tvsAsyncError.same(stream.get('y'), 0, 'y is 0');
        tvsAsyncError.same(stream.get('saved'), false, 'saved is false');

        stream.do.setX(100);
        stream.do.add(200, 200);

        const { errors, values, done } = monitor;

        tvsAsyncError.same(done, false, 'not done');

        tvsAsyncError.same(errors, [{
          error: {
            actionName: 'post',
            error: {
              saved: false, x: 0, y: 0, message: 'x or y must be non-zero',
            },
            params: [],
          },
          id: 'coord',
          name: 'coord',
        }], 'has errors');

        tvsAsyncError.same(values, [
          { x: 0, y: 0, saved: false },
          { x: 0, y: 0, saved: false },
          { x: 100, y: 0, saved: false },
          { x: 300, y: 0, saved: false },
          { x: 300, y: 200, saved: false },
        ], 'values emitted after error');

        tvsAsyncError.end();
      });

      tvsMethods.end();
    });

    testValueStream.end();
  });

  suite.end();
});
