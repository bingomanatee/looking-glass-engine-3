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
    })
    .method('addAndPostT', (stream, x, y) => {
      stream.do.add(x, y);
      return stream.do.post();
    }, true)
    .method('addT', (stream, x, y) => {
      stream.do.add(x, y);
    }, true);

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

      tvsMethods.test('simple, synchronous, transactional', async (tvsTrans) => {
        const stream = coordFactory();
        const monitor = monitorMulti(stream);

        tvsTrans.same(stream.countOfTransactions(), 0);
        stream.do.add(2, -4);
        tvsTrans.same(stream.countOfTransactions(), 0);
        tvsTrans.same(stream.get('x'), 2, 'x is 2');
        tvsTrans.same(stream.get('y'), -4, 'y is -4');

        tvsTrans.same(monitor.values, [
          { x: 0, y: 0, saved: false },
          { x: 2, y: 0, saved: false },
          { x: 2, y: -4, saved: false },
        ], 'add fires off two updates');

        await stream.do.addT(3, 6);
        tvsTrans.same(stream.countOfTransactions(), 0);

        tvsTrans.same(monitor.values, [
          { x: 0, y: 0, saved: false },
          { x: 2, y: 0, saved: false },
          { x: 2, y: -4, saved: false },
          { x: 5, y: 2, saved: false },
        ], 'add fires off one more updates');

        tvsTrans.end();
      });

      tvsMethods.test('async, transactional', async (tvsTransAsync) => {
        const stream = coordFactory();
        const monitor = monitorMulti(stream);

        tvsTransAsync.same(stream.countOfTransactions(), 0);
        await stream.do.addAndPostT(3, 6);
        tvsTransAsync.same(stream.countOfTransactions(), 0);

        tvsTransAsync.same(monitor.values, [
          { x: 0, y: 0, saved: false },
          { x: 3, y: 6, saved: true },
        ], 'fires off a single event after the async is done');

        tvsTransAsync.end();
      });

      tvsMethods.test('async, transactional with errors', async (tvsTransAsync) => {
        const stream = coordFactory();
        const monitor = monitorMulti(stream);

        tvsTransAsync.same(stream.countOfTransactions(), 0);
        const result = await stream.do.addAndPostT(3, 6);
        tvsTransAsync.same(result, {
          saved: true, x: 3, y: 6, id: 1000,
        }, 'still returns result');

        const result2 = await stream.do.addAndPostT(-3, -6);
        tvsTransAsync.same(result2, {
          error: {
            saved: false, x: 0, y: 0, message: 'x or y must be non-zero',
          },
        },
        'still returns result');

        await stream.do.addAndPostT(1, 1);
        tvsTransAsync.same(stream.countOfTransactions(), 0);

        tvsTransAsync.same(monitor.values, [
          { x: 0, y: 0, saved: false },
          { x: 3, y: 6, saved: true },
          { x: 0, y: 0, saved: false },
          { x: 1, y: 1, saved: true },
        ], 'updates on and after error');

        tvsTransAsync.end();
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

        console.log('result of async:', result);
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

    testValueStream.test('properties', (tvsProps) => {
      tvsProps.test('my', (my) => {
        const coord = coordFactory();

        my.same(coord.my.x, 0, 'x starts as 0');
        my.same(coord.my.y, 0, 'y starts as 0');

        coord.do.add(2, 3);

        my.same(coord.my.x, 2, 'x goes to 2');
        my.same(coord.my.y, 3, 'y goes to 3');

        my.end();
      });

      tvsProps.test('type', (type) => {
        const stream = new ValueStream('typer')
          .property('a', 1) // no type
          .property('b', 2, 'integer') // is type
          .property('c', 'three', 'string') // /is type
          .property('d', 1, (value, name) => {
            if (!is.number(value)) {
              return `${name} must be a number`;
            }
            if (value < 0) {
              return `${name} must be >= 0`;
            }
            if (value > 4) {
              return `${name} must be <= 4`;
            }
            return false;
          }); // test


        type.same(stream.my.a, 1);
        type.same(stream.my.b, 2);
        type.same(stream.my.c, 'three');
        type.same(stream.my.d, 1);

        const result = monitorMulti(stream);

        stream.do.setA(10);
        stream.do.setB(10);
        stream.do.setC(10);
        stream.do.setC('four');
        stream.do.setD(10);
        stream.do.setD(3);

        console.log('errors: ', JSON.stringify(result.errors));

        type.same(result.errors, [{
          error: {
            error: { message: 'wrong type', value: 10 },
            id: 'typer.c',
            name: 'c',
            source: 'c',
            target: 'typer',
          },
          id: 'typer',
          name: 'typer',
        }, {
          error: {
            error: { error: 'd must be <= 4', value: 10 },
            id: 'typer.d',
            name: 'd',
            source: 'd',
            target: 'typer',
          },
          id: 'typer',
          name: 'typer',
        }],
        'some properties throw errors');

        type.same(stream.my.a, 10);
        type.same(stream.my.b, 10);
        type.same(stream.my.c, 'four');
        type.same(stream.my.d, 3);
        type.end();
      });
      tvsProps.end();
    });

    testValueStream.test('watch', (w) => {
      w.test('single value', (wsv) => {
        const makeSingleValueStream = () => {
          const stream = new ValueStream('count', 0, 'number')
            .method('incDouble', (stream) => {
              stream.do.inc();
              stream.do.double();
            }, true)
            .method('inc', (stream) => {
              stream.set(stream.value + 1);
            })
            .method('double', (stream) => {
              stream.set(stream.value * 2);
            });

          return stream;
        };

        wsv.test('on set', (wsvOnSet) => {
          const stream = makeSingleValueStream();
          const changes = [];

          stream.watch((data) => changes.push(data));

          wsvOnSet.same(changes, [], 'starts without changes');

          stream.set(3);

          wsvOnSet.same(changes, [{ name: 'count', prev: 0, value: 3 }]);
          stream.complete();
          wsvOnSet.end();
        });

        wsv.test('on method', (wsvOnMethod) => {
          const stream = makeSingleValueStream();
          const changes = [];

          stream.watch((data) => changes.push(data));

          stream.do.inc();

          wsvOnMethod.same(changes, [{ name: 'count', prev: 0, value: 1 }]);
          stream.complete();
          wsvOnMethod.end();
        });

        wsv.test('on method, transactional', (wsvOnMethod) => {
          const stream = makeSingleValueStream();
          const changes = [];

          stream.watch((data) => changes.push(data));

          stream.do.incDouble();

          wsvOnMethod.same(changes, [
            { name: 'count', prev: 0, value: 1 },
            { name: 'count', prev: 1, value: 2 },
          ]);
          wsvOnMethod.end();
        });

        wsv.end();
      });

      w.test('multi value', (wmv) => {
        const stream = coordFactory();

        const changes = [];

        stream.watch('x', (change) => changes.push(change));

        wmv.same(changes, [], 'starts empty');

        stream.do.setY(2);

        wmv.same(changes, [], 'ignores other properties');

        stream.do.add(2, 2);

        wmv.same(changes, [{
          name: 'x', value: 2, source: 'x', prev: 0, target: 'coord',
        }], 'notices x change');

        stream.set('x', 3);
        wmv.same(changes, [{
          name: 'x', value: 2, source: 'x', prev: 0, target: 'coord',
        },
        {
          name: 'x', value: 3, source: 'x', prev: 2, target: 'coord',
        }], 'notices x change from set');

        stream.set('x', 3);
        wmv.same(changes, [{
          name: 'x', value: 2, source: 'x', prev: 0, target: 'coord',
        },
        {
          name: 'x', value: 3, source: 'x', prev: 2, target: 'coord',
        }], 'ignores non-change');

        stream.complete();
        wmv.end();
      });
      w.end();
    });

    testValueStream.end();
  });

  suite.end();
});
