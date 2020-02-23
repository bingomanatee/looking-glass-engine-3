/* eslint-disable no-param-reassign */
import { proppify } from '@wonderlandlabs/propper';
import {
  BehaviorSubject, Subject, merge, combineLatest,
} from 'rxjs';
import {
  map, distinct, filter, startWith,
} from 'rxjs/operators';
import is from 'is';
import lodashGet from 'lodash.get';
import capFirst from './capFirst';
import Transaction from './Transaction';
import typeTestFor from './typeTestFor';

const ABSENT = Symbol('ABSENT');
const has = (v) => v && (v !== ABSENT);
const propRE = /^[\w_][\w_\d]*$/;
const SCALAR_TYPES = [
  'string',
  'number',
  'int',
  'integer',
  'bool',
  'boolean',
];

/**
 * A note on streams:
 * the 'error' in the observable trilogy of `.subscribe(next, error, complete)` is intended to be a terminal error,
 * immediately preceding a shutdown.
 * ValueStreams bend over backwards to ensure this never occurs in ordinary execution; therefore,
 * the error observer gets _managed_ errors that are created when you try to set a value, or when an method
 * throws an error that we have caught.
 *
 * _current
 *   This is a polymorphic value.
 *   * For singleSubject streams:  it gets each value update.
 *   * For streams with children: it gets a repeated emission of the stream itself.
 *                                to reduce wastes of computing resources by
 *                                continuously serializing potentially large trees.
 *
 * _changes
 *   This stream emits a pairwise stream of changes from a single value stream.
 *
 * _transCount
 *   This stream increments and decrements as transactions are created.
 *   It is the count of open transactions in the _trans set;
 *
 */
class ValueStream {
  /**
   * note - only single-value streams accept more than one parameter;
   *
   * @param name {String}
   * @param value {var|ABSENT}
   * @param type {String|ABSENT}
   */
  constructor(name, value = ABSENT, type = ABSENT) {
    if (!name) {
      name = `stream ${Math.random()}`;
    }
    this.name = name;
    this._errors = new Subject();
    this._value = value;
    this.do = {};

    if (this.isSingleValue) {
      if (type && (!(type === ABSENT))) {
        if (is.string(type)) {
          this._type = type;
        } else if (is.fn(type)) {
          this._test = type;
        }
      }
    }
  }

  emit(message, ...args) {
    this._getEmitter(message).next(args);
    return this;
  }

  get _emitterListeners() {
    if (!this.__emitterListeners) {
      this.__emitterListeners = new Map();
    }
    return this.__emitterListeners;
  }

  on(message, listener) {
    if (!this._emitterListeners.has(message)) {
      this._emitterListeners.set(message, new Set());
    }
    this._emitterListeners.get(message).add(listener);
    return this;
  }

  off(message, listener) {
    if ((!listener) || (!is.fn(listener) || is.string(listener))) {
      console.log('off requires a function; if you want to remove all listeners, use "offAll"');
      return this;
    }
    if (this._emitterListeners.has(message)) {
      this._emitterListeners(message).delete(listener);
    }
    return this;
  }

  offAll(message) {
    if (!(message && is.string(message))) {
      console.log('emitter request must be a nonempty string');
      return;
    }
    this._emitterListeners.delete(message);
  }

  _getEmitter(name) {
    if (!(name && is.string(name))) {
      throw new Error('emitter request must be a nonempty string');
    }

    if (!this._emitters) {
      this._emitters = new Map();
    }

    if (!this._emitters.has(name)) {
      const subject = new Subject();
      this._emitters.set(name, subject);
      subject._sub = subject.subscribe((args) => {
        if (this._emitterListeners.has(name)) {
          this._emitterListeners.get(name)
            .forEach((listener) => {
              if (is.string(listener) && this.do[listener]) {
                this.do[listener](...args);
              }
              if (is.fn(listener)) {
                listener(this, ...args);
              }
            });
        }
      });
    }

    return this._emitters.get(name);
  }

  closeTransaction(trans) {
    if (this._trans) {
      this._trans.delete(trans);
    }
    this._transCount.next(this.countOfTransactions());
  }

  addTransaction(name, params) {
    if (!this._trans) {
      this._trans = new Set();
    }
    const trans = new Transaction({
      name,
      params,
      target: this,
    });

    this._trans.add(trans);
    this._transCount.next(this.countOfTransactions());

    return trans;
  }

  get _methods() {
    if (!this.___methods) {
      this.___methods = new Map();
    }

    return this.___methods;
  }

  get type() {
    return this._type || ABSENT;
  }

  get test() {
    return this._test || ABSENT;
  }

  hasTest() {
    return this.test && (this.test !== ABSENT) && (typeof this.test === 'function');
  }

  hasType() {
    return this.type && (this.type !== ABSENT) && (typeof is[this.type] === 'function');
  }

  get id() {
    if (has(this.parent)) {
      return `${this.parent.id}.${this.name}`;
    }
    return this.name;
  }

  get isSingleValue() {
    return !(this._value === ABSENT);
  }

  /* ------------------------- streams ------------------------- */

  _currentValue() {
    return this.isSingleValue ? this.value : this;
  }

  /**
   * _current reflects the latest value of a ValueStream a la redux actions.
   * It is triggered by
   *
   * 1. the _changes stream
   * 2. changes in the count of transactions
   *
   * to emit an update WHEN there are changes.
   * It does not emit when there are active transactions.
   *
   * @returns {BehaviorSubject<{value: (var|ABSENT)}|ValueStream>}
   * @private
   */
  get _current() {
    if (!this.___current) {
      this.___current = combineLatest(this._changes, this._transCount)
        .pipe(
          filter(([__, trans]) => (trans < 1)),
          map(() => this._currentValue()),
          startWith(this._currentValue()),
        );
    }
    return this.___current;
  }

  /**
   * This is an unfiltered stream of the value updates.
   * It doesn't update until the value is changed.
   * Unlike _current, it is unaffected by transactions.
   *
   * @returns {Subject<T> | Subject<unknown>}
   * @private
   */
  get _valueStream() {
    if (!this.__valueStream) {
      this.__valueStream = new Subject();
      this._valueStreamSub = this.__valueStream.subscribe((value) => {
        this._value = value;
      });
    }
    return this.__valueStream;
  }

  /**
   * single value streams' _changes stream is a linear history of the changes of its' value.
   * multi-value streams' _changes stream is a combination of the _changes streams of all the valueStreams children.
   * @returns {Observable}
   * @private
   */
  get _changes() {
    if (!this.__changes) {
      if (this.isSingleValue) {
        let previous = this.isSingleValue ? this.value : ABSENT;
        const changeMap = (value) => {
          if (!(previous === ABSENT)) {
            const prev = previous;
            previous = value;
            return { name: this.name, prev, value };
          }
          previous = value;
          return { name: this.name, value };
        };

        this.__changes = this._valueStream.pipe(map(changeMap));
    /*    if (SCALAR_TYPES.includes(this.type)) {
          // suppress updates that do not change the value
          this.__changes = this._valueStream.pipe(distinct(), map(changeMap));
        } else {
        }*/
      } else {
        this.__changes = new Subject(); // it is children's job to push changes into the subject
      }
    }
    return this.__changes;
  }

  /**
   * manually trigger a change notification.
   * This is useful if you change a property/element of a Map,
   * array, or object; instead of clumsily cloning or re-injecting
   * a complex value, you can trigger a change notification manually.
   *
   * @param property
   */
  broadcast(property) {
    if (property) {
      const value = this.get(property);
      this._changes.next({
        name: property,
        value,
        broadcast: true,
        target: this.name,
      });
    } else {
      this._changes.next({});
    }
    return this;
  }

  countOfTransactions() {
    if (!this._trans) {
      return 0;
    }
    let count = 0;
    this._trans.forEach((value) => {
      count += value.open ? 1 : 0;
    });

    return count;
  }

  get _transCount() {
    if (!this.__transCount) {
      this.__transCount = new BehaviorSubject(this.countOfTransactions());
    }
    return this.__transCount;
  }

  /** ------------------- Properties ------------------- */

  /**
   * convert to multi-value. Optionally demote the current value to
   * a named child
   * @param name
   */
  branch(name) {
    if (!this.isSingleValue) {
      console.log('attempt to branch already multi-value', this.name);
      return;
    }
    const value = this._value;
    this._value = ABSENT;

    if (name) {
      this.property(name, value, this.type);
    }
    // else the value is extinguished
  }

  get children() {
    if (!this._children) {
      this._children = new Map();
    }
    return this._children;
  }

  /**
   * define a value to observe. This is a multi-value method.
   * This method creates a sub-stream that is itself a value stream and puts it in a map as a
   * child of this stream.
   *
   * NOTE: at this point there is no predicted behavior of deeply nested ValueStreams.
   * This will be added in the near future possibly but to date, all use cases have been focusing
   * on one-level value streams.
   *
   * @param name {String}
   * @param value {var}
   * @param type {String}?
   * @returns {ValueStream}
   */
  property(name, value, type) {
    if (this.isSingleValue) {
      throw new Error('cannot property sub-streams to stream with an single value');
    }

    if (name instanceof ValueStream) {
      return this.property(name.name, name);
    }

    if (!(name && is.string(name))) {
      throw new Error(`cannot add to ${this.name} - bad name ${name}`);
    }
    if (!propRE.test(name)) {
      throw new Error(`cannot add to ${this.name} - bad name ${name} -- bad javaScript property`);
    }

    const subStream = (value instanceof ValueStream) ? value : new ValueStream(name, value, type);
    subStream.parent = this;
    // cascade child errors and updates to parents streams
    subStream._changes.subscribe((change) => {
      this._changes.next({ ...change, source: name, target: this.name });
    });
    subStream.subscribe(() => {
    }, (error) => {
      this.emitError({ ...error, source: name, target: this.name });
    });

    this.children.set(name, subStream);

    // property set method
    this.method(capFirst(name, 'set'), (stream, value2 = ABSENT) => {
      if (!(value2 === ABSENT)) {
        stream.set(name, value2);
      }
      return stream.get(name);
    });

    // property alter method
    const toName = capFirst(name, 'to');
    this.method(toName, (stream, method) => {
      if (is.function(method)) {
        let result;
        try {
          result = method(stream.get(name));
        } catch (error) {
          this.emitError({
            error,
            method,
            name: toName,
          });
          return stream.get(name);
        }
        if (this.hasTest()) {
          const error = this.test(value, this.name, is, this);
          if (error) {
            this.emitError({
              error,
              value,
              name: toName,
            });
            return stream.get(name);
          }
        }
        this.set(name, result);
      }
      return stream.get(name);
    });

    return this;
  }

  hasProperty(name) {
    return this.children.has(name);
  }

  /**
   * a special case - creates a number limited to a numeric ragne.
   * @param name {String}
   * @param value {}
   * @param params {object}
   */
  propertyRange(name, value, params = {}) {
    const type = lodashGet(params, 'type', 'number');
    const min = lodashGet(params, 'min', Number.NEGATIVE_INFINITY);
    const max = lodashGet(params, 'max', Number.POSITIVE_INFINITY);

    if (is.number(value)) {
      if (is.number(min)) {
        value = Math.max(min, value);
      }

      if (is.number(max)) {
        value = Math.min(max, value);
      }
    }

    const typeTest = typeTestFor(type, name);

    const test = (nextValue, nameStr) => {
      const error = typeTest(nextValue);
      if (error) {
        console.log('propertyRange - returning ', error);
        return error;
      }
      if (min !== Number.NEGATIVE_INFINITY) {
        if (!is.ge(nextValue, min)) {
          return `${nameStr} must be >= ${min}`;
        }
      }
      if (max !== Number.POSITIVE_INFINITY) {
        if (!is.le(nextValue, max)) {
          return `${nameStr} must be <= ${max}`;
        }
      }
      return false;
    };

    return this.property(name, value, test);
  }

  getStream(name) {
    return (!this.isSingleValue) && this._children.has(name) && this._children(name);
  }

  _update(value) {
    if (!this.isSingleValue) {
      this.emitError({ message: 'attempt to call _update on a multi-value', value });
      return;
    }
    if (this.hasType()) {
      if (!is[this.type](value)) {
        this.emitError({
          message: 'wrong type',
          value,
        });
        return;
      }
    }

    if (this.hasTest()) {
      const error = this.test(value, this.name, is, this);
      if (error) {
        this.emitError({
          error,
          value,
        });
        return;
      }
    }
    this._valueStream.next(value);
  }

  set(alpha, beta) {
    if (this.isSingleValue) {
      this._update(alpha);
    } else if (!this.children.has(alpha)) {
      console.log('attempt to set unknown child value', alpha, 'with', beta);
    } else {
      this.children.get(alpha).set(beta);
    }
    return this;
  }

  get(name) {
    if (this.isSingleValue) {
      return this.value;
    }
    if (!this.children.has(name)) {
      console.log('attempt to get unknown child value', name);
      return undefined;
    }
    return this.children.get(name).value;
  }

  /* ---------------------- Methods ------------------------ */
  /**
   * A curried method to define an method.
   *
   * @param methodName {String}
   * @param fn {function}
   * @param transact {boolean}
   * @returns {this}
   */
  method(methodName, fn, transact = false) {
    if (!(methodName && is.string(methodName))) {
      throw new Error('method requires a legal javaScript property name as the first parameter');
    }
    if (!propRE.test(methodName)) {
      throw new Error(`the method name, "${methodName}" is not a valid javaScript property name`);
    }
    if (!is.fn(fn)) {
      throw new Error('method requires a function as the second parameter');
    }

    if (this._methods.has(methodName)) {
      console.log(this.name, 'already has an method ', methodName);
    } else {
      this._methods.set(methodName, this.methodFactory(methodName, fn, transact));
      this.do[methodName] = this._methods.get(methodName);
    }

    return this;
  }

  /**
   * a legacy alias to define.
   * @param args
   * @returns {ValueStream}
   */
  addAction(...args) {
    return this.method(...args);
  }

  /**
   * returns a bound function that performs the defined method
   * @param methodName {String}
   * @param fn {function}
   * @param transact {boolean}
   * @returns {function(...[*]=): Promise<*|{error: *}|undefined|{error: *}>|{error}|undefined|{error}|{error: *}}
   */
  methodFactory(methodName, fn, transact = false) {
    return (...args) => {
      if (transact) {
        const transaction = this.addTransaction(methodName, args);
        const result = this.perform(methodName, fn, args);

        if (Promise.resolve(result) === result) {
          // delay the end of transaction to resolution of promise
          return result.then((value) => {
            transaction.complete();
            return value;
          })
            .catch((error) => {
              transaction.complete(error);
              return error;
            });
        }
        transaction.complete();

        return result;
      }

      return this.perform(methodName, fn, args);
    };
  }

  /**
   * Perform will attempt to methodFactory the method in the safest possible context
   * trapping and properly channeling all errors; if a function or promise is resolved,
   * it recurses  -- "unravels" -- it until a non-promise non-function is returned.
   *
   * @param actionName {String}
   * @param fn {Function}
   * @param params {Array} optional arguments to function
   * returns the value returned by fn, or a promise of it
   */
  perform(actionName, fn, params = []) {
    try {
      // noinspection JSIncompatibleTypesComparison
      if (Promise.resolve(fn) === fn) {
        return fn.then((value) => this.perform(actionName, value, params))
          .catch((error) => {
            this.emitError({
              error,
              actionName,
              params,
            });
            return { error };
          });
      }
      if (is.fn(fn)) {
        return this.perform(actionName, fn(this, ...params), params);
      }
      // the return value of the method is not a function or a promise. return it as the result.
      return fn;
    } catch (error) {
      this.emitError({
        error,
        actionName,
        params,
      });
      return { error };
    }
  }

  /* ---------------------- Value --------------------- */

  toObject() {
    return this.isSingleValue ? { value: this.value } : Array.from(this.children.keys())
      .reduce((obj, key) => {
        const child = this.children.get(key);
        if (child.isSingleValue) {
          obj[key] = child.value;
        } else {
          obj[key] = child.toObject();
        }
        return obj;
      }, {});
  }

  get value() {
    if (this.isSingleValue) {
      return this._value;
    }
    return this.toObject();
  }

  get my() {
    if ((this.isSingleValue) || (typeof Proxy === 'undefined')) {
      return this.value;
    }

    if (!this._proxy) {
      this._proxy = new Proxy(this, {
        get(obj, name) {
          return obj.get(name);
        },
        set(obj, name, value) {
          return obj.set(name, value);
        },
      });
    }
    return this._proxy;
  }

  /* --------------------- Observable methods ----------- */

  // combines the subject stream and the error stream into a single stream
  get valueErrorStream() {
    if (!this._valueErrorStream) {
      this._valueErrorStream = merge(
        this._current.pipe(map(() => ({ type: 'value', message: this }))),
        this._errors.pipe(map((error) => ({ type: 'error', message: error }))),
      );
    }
    return this._valueErrorStream;
  }

  /**
   * return a subset clone of this stream
   * that has a subset of properties; useful for creating a shapshot that only updates
   * when a given property changes.
   * @param properties
   * @returns {ValueStream}
   */

  filtered(...properties) {
    let flatProps = [];
    properties.forEach((p) => {
      if (!p) {
        return;
      }
      if (is.string(p)) {
        flatProps.push(p);
      }
      if (Array.isArray(p)) {
        flatProps = [...flatProps, ...p];
      }
    });

    const validProps = flatProps.filter((p) => (p && is.string(p) && this.hasProperty(p)));
    if (!validProps) {
      throw new Error(`${this.name} has no properties in ${properties.join(',')}`);
    }
    const filtered = new ValueStream(`${this.name}_filtered_${validProps.join('_')}`);

    const cloneTrans = this._transCount.subscribe((count) => {
      try {
        filtered._transCount.next(count);
      } catch (err) {
        console.log('transCount error: ', err);
      }
    },
    () => {
    },
    () => cloneTrans.unsubscribe());

    validProps.forEach((p) => {
      filtered.property(p, this.children.get(p));
    });

    return filtered;
  }

  /**
   * Note - this
   * @param onNext {function}
   * @param onError {function}
   * @param onComplete {function}
   * @returns {Subscription}
   */
  subscribe(onNext, onError, onComplete) {
    if (onNext && typeof onNext !== 'function') {
      throw new Error('subscribe onNext must be a function');
    }
    if (onError && typeof onError !== 'function') {
      throw new Error('subscribe onError must be a function');
    }
    if (onComplete && typeof onComplete !== 'function') {
      throw new Error('subscribe onNext must be a function');
    }

    return this.valueErrorStream.subscribe(({ type, message }) => {
      switch (type) {
        case 'error':
          if (onError) {
            onError(message);
          }
          break;

        case 'value':
          if (onNext) {
            onNext(this);
          }
          break;

        default:
          console.log('strange message type for subscription to ', this.name, ':', type);
      }
    }, onError, onComplete);
  }

  emitError(params) {
    if (params) {
      if (is.string(params)) {
        this.emitError({ error: params });
      } else if (is.object(params && 'error' in params)) {
        this._errors.next({ ...params, id: this.id, name: this.name });
      } else {
        // assume the params is an error clump
        this._errors.next({ error: params, id: this.id, name: this.name });
      }
    }
  }

  complete() {
    if (this._emitters) {
      this._emitters.forEach((sub) => sub.complete());
    }
    if (this._changes) {
      this._changes.complete();
    }
    if (this._transCount) {
      this._transCount.complete();
    }
    if (this._valueStreamSub) {
      this._valueStreamSub.unsubscribe();
    }
    if (this._errors) {
      this._errors.complete();
    }
  }

  watchStream(alpha) {
    if (this.isSingleValue) {
      return this._changes;
    }
    return this._changes.pipe(filter((change) => (change.name === alpha && change.target === this.name)));
  }

  /**
   * given an array of strings and functions,
   * replaces the strings into method calls
   * @param methods
   * @returns {[function]}
   * @private
   */
  _interpret(method) {
    if (is.string(method)) {
      return (...args) => this.do[method](...args);
    }
    return (...args) => method(this, ...args);
  }

  watch(alpha, beta, gamma, delta) {
    if (this.isSingleValue) {
      this.watchStream().subscribe(this._interpret(alpha));
    } else {
      this.watchStream(alpha).subscribe(this._interpret(beta), gamma, delta);
    }
    return this;
  }

  watchFlat(alpha, beta, gamma, delta) {
    if (this.isSingleValue) {
      this.watchStream().subscribe(({ value, prev }) => this._interpret(alpha)(value, prev, this.name), beta, gamma);
    } else {
      this.watchStream(alpha).subscribe(({ value, prev }) => this._interpret(beta)(value, prev, alpha), gamma, delta);
    }
    return this;
  }
}

proppify(ValueStream)
  .addProp('parent', null);

export default ValueStream;
