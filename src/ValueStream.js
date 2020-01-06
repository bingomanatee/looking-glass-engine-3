/* eslint-disable no-param-reassign */
import { proppify } from '@wonderlandlabs/propper';
import {
  BehaviorSubject, Subject, merge, combineLatest,
} from 'rxjs';
import { map, distinct, filter } from 'rxjs/operators';
import is from 'is';
import _ from 'lodash';
import capFirst from './capFirst';
import Transaction from './Transaction';

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
 * the error observer gets _managed_ errors that are created when you try to set a value, or when an action
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
    if (!name) name = `stream ${Math.random()}`;
    this.name = name;
    this._errors = new Subject();
    this._value = value;
    this.do = {};

    if (this.isSingleValue) {
      if (type && (!(type === ABSENT))) {
        if (!is.string(type)) {
          throw new Error(`bad type value for ${name}: ${type}`);
        }
        this._type = type;
      }
    }
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
   * to emit an update WHEN there are changes AND there are not any active transactions
   *
   * @returns {BehaviorSubject<{value: (var|ABSENT)}|ValueStream>}
   * @private
   */
  get _current() {
    if (!this.___current) {
      this.___current = new BehaviorSubject(this._currentValue());
      this._currentSub = combineLatest(this._changes, this._transCount)
        .pipe(
          filter(([__, trans]) => (trans < 1)),
        )
        .subscribe(() => {
          this.___current.next(this._currentValue());
        });
    }
    return this.___current;
  }

  /**
   * single value streams' _changes stream is a linear history of the changes of its' value.
   * multi-value streams' _changes stream is a combination of the _changes streams of all the valueStreams children.
   * @returns {Observable}
   * @private
   */
  get _changes() {
    let previous = ABSENT;

    const changeMap = (value) => {
      if (!(previous === ABSENT)) {
        const prev = previous;
        previous = value;
        return { name: this.name, prev, value };
      }
      previous = value;
      return { name: this.name, value };
    };

    if (!this.__changes) {
      if (this.isSingleValue) {
        if (SCALAR_TYPES.includes(this.type)) {
          this.__changes = this.__changesBase.pipe(distinct(), map(changeMap));
        } else {
          this.__changes = this.__changesBase.pipe(map(changeMap));
        }
      } else {
        this.__changes = new Subject(); // it is children's job to push changes into the subject
      }
    }
    return this.__changes;
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
    const { type } = this;
    this._value = ABSENT;

    if (name) {
      this.property(name, value, type);
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

    return this;
  }

  /**
   * This is the raw value that has changed. Changes emits a complex type with metadata about the change
   * @returns {Subject<T> | Subject<unknown>}
   * @private
   */
  get __changesBase() {
    if (!this.___changesBase) {
      this.___changesBase = new Subject();
    }
    return this.___changesBase;
  }

  _update(value) {
    if (this.hasType()) {
      if (!is[this.type](value)) {
        this.emitError({
          message: 'wrong type',
          value,
        });
        return;
      }
    }
    this._value = value;
    this.__changesBase.next(value);
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
    if (!this.children.has(name)) {
      console.log('attempt to get unknown child value', name);
      return undefined;
    }
    return this.children.get(name).value;
  }

  /* ---------------------- Methods ------------------------ */
  /**
   * A curried method to define an action.
   *
   * @param actionName {String}
   * @param fn {function}
   * @param transact {boolean}
   * @returns {this}
   */
  method(actionName, fn, transact = false) {
    if (!(actionName && is.string(actionName))) {
      throw new Error('method requires a string as the first parameter');
    }
    if (!propRE.test(actionName)) {
      throw new Error(`the action name ${actionName} is not a valid javaScript property`);
    }
    if (!is.fn(fn)) {
      throw new Error('method requires a function as the second parameter');
    }

    if (this._methods.has(actionName)) {
      console.log(this.name, 'already has an action ', actionName);
    } else {
      this._methods.set(actionName, this.actionFactory(actionName, fn, transact));
      this.do[actionName] = this._methods.get(actionName);
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
   * returns a bound function that performs the defined action
   * @param actionName {String}
   * @param fn {function}
   * @param transact {boolean}
   * @returns {function(...[*]=): Promise<*|{error: *}|undefined|{error: *}>|{error}|undefined|{error}|{error: *}}
   */
  actionFactory(actionName, fn, transact = false) {
    return (...args) => {
      if (transact) {
        const transaction = this.addTransaction(actionName, args);
        const result = this.perform(actionName, fn, args);

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

      return this.perform(actionName, fn, args);
    };
  }

  async asyncPerform(actionName, promise, params) {
    try {
      const result = await (promise);
      if (result) {
        return this.perform(actionName, result, params);
      }
      return null;
    } catch (error) {
      this.emitError({
        actionName,
        error,
        params,
      });
      return { error };
    }
  }

  /**
   * Perform will attempt to actionFactory the method in the safest possible context
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
        return this.asyncPerform(actionName, fn, params);
      }
      if (is.fn(fn)) {
        const result = fn(this, ...params);
        if (result) {
          return this.perform(actionName, result, params);
        }
        return result;
      }
      // the return value of the action is not a function or a promise. return it as the result.
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

  /* --------------------- Observable methods ----------- */

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

    // combines the subject stream and the error stream into a single stream

    const sub = merge(
      this._current.pipe(map(() => ({ type: 'value', message: this }))),
      this._errors.pipe(map((error) => ({ type: 'error', message: error }))),
    );

    return sub.subscribe(({ type, message }) => {
      switch (type) {
        case 'error':
          if (onError) {
            onError(message);
          }
          break;

        case 'value':
          if (onNext) {
            onNext(message);
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
    if (this._current) {
      this._current.complete();
    }
    if (this._currentSub) {
      this._currentSub.unsubscribe();
    }
    if (this._changes) {
      this._changes.complete();
    }
    if (this._transCount) {
      this._transCount.complete();
    }
    if (this._errors) {
      this._errors.complete();
    }
  }
}

proppify(ValueStream)
  .addProp('parent', null);

export default ValueStream;
