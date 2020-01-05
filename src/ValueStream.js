/* eslint-disable no-param-reassign */
import { proppify } from '@wonderlandlabs/propper';
import { BehaviorSubject, Subject, merge } from 'rxjs';
import { map, pairwise, distinct } from 'rxjs/operators';
import is from 'is';
import _ from 'lodash';
import capFirst from './capFirst';

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
 * the 'error' in the observable trilogy of `.subsccribe(next, error, complete)` is intended to be a terminal error,
 * immediately preceding a shutdown.
 * ValueStreams bend over backwards to ensure this never occurs in ordinary execution; therefore,
 * the error observer gets _managed_ errors that are created when you try to set a value, or when an action
 * throws an error that we have caught.
 *
 * _subject
 *   This is a polymorphic value. For singleSubject streams it gets each value update.
 *   For streams with children, it gets a repeated emission of the stream itself.
 *   This reason it doesn't emit a serialization of the value tree is to reduce
 *   wastes of computing resources continuously serializing potentially large trees.
 *
 * _changes
 *   This stream emits a pairwise stream of changes from a single value stream.
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
    this.name = name;
    this._errors = new Subject();
    this._value = value;
    this._actions = new Map();
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

  _subjectValue() {
    return this.isSingleValue ? this.value : this;
  }

  /**
   * every time the value (or a child value) changes, emit a new subject.
   * That subject is not a function (directly) of the change.
   * //@TODO: integrate transactions
   * @returns {BehaviorSubject<{value: (var|ABSENT)}|ValueStream>}
   * @private
   */
  get _subject() {
    if (!this.__subject) {
      this.__subject = new BehaviorSubject(this._subjectValue());
      this._changes.subscribe(() => this.__subject.next(this._subjectValue()));
    }
    return this.__subject;
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
      this.add(name, value, type);
    }
    // else the value is extinguished
  }

  get children() {
    if (!this._children) {
      this._children = new Map();
    }
    return this._children;
  }

  add(name, value, type) {
    if (this.isSingleValue) {
      throw new Error('cannot add sub-streams to stream with an single value');
    }
    if (!(name && is.string(name))) {
      throw new Error(`cannot add to ${this.name} - bad name ${name}`);
    }
    if (!propRE.test(name)) {
      throw new Error(`cannot add to ${this.name} - bad name ${name} -- bad javaScript property`);
    }

    const subStream = new ValueStream(name, value, type);
    subStream.parent = this;
    // cascade child errors and updates to parents streams
    subStream._changes.subscribe((change) => {
      this._changes.next({ child: name, change });
    }, (error) => {
      console.log('===== substream error: ', error);
      this.emitError({ child: name, error });
    });
    subStream.subscribe(() => {}, (error) => {
      this.emitError({ child: name, error });
    });

    this.children.set(name, subStream);

    // add set method
    this.define(capFirst(name, 'set'), (stream, value2 = ABSENT) => {
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
          error: 'wrong type',
          value,
          target: this.id,
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
    } else {
      this.children.get(name).value;
    }
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
  define(actionName, fn, transact = false) {
    if (!(actionName && is.string(actionName))) {
      throw new Error('define requires a string as the first parameter');
    }
    if (!propRE.test(actionName)) {
      throw new Error(`the action name ${actionName} is not a valid javaScript property`);
    }
    if (!is.fn(fn)) {
      throw new Error('define requires a function as the second parameter');
    }

    if (this._actions.has(actionName)) {
      console.log(this.name, 'already has an action ', actionName);
    } else {
      this._actions.set(actionName, this.actionFactory(actionName, fn, transact));
      this.do[actionName] = this._actions.get(actionName);
    }

    return this;
  }

  /**
   * a legacy alias to define.
   * @param args
   * @returns {ValueStream}
   */
  addAction(...args) {
    return this.define(...args);
  }

  /**
   * returns a bound function that performs the defined action
   * @param actionName {String}
   * @param fn {function}
   * @param transact {boolean}
   * @returns {function(...[*]=): Promise<*|{error: *}|undefined|{error: *}>|{error}|undefined|{error}|{error: *}}
   */
  actionFactory(actionName, fn, transact = false) {
    return (...args) => this.perform(actionName, fn, transact, args);
  }

  async asyncPerform(actionName, promise, transact, params) {
    try {
      const result = await (promise);
      if (result) {
        return this.perform(actionName, result, transact, params);
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
   * @param transact {boolean} // @TODO make this do something
   * @param params {Array} optional arguments to function
   * returns the value returned by fn, or a promise of it
   */
  perform(actionName, fn, transact = false, params = []) {
    try {
      // noinspection JSIncompatibleTypesComparison
      if (Promise.resolve(fn) === fn) {
        return this.asyncPerform(actionName, fn, transact, params);
      }
      if (is.fn(fn)) {
        const result = fn(this, ...params);
        if (result) {
          return this.perform(actionName, result, transact, params);
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
      this._subject.pipe(map(() => ({ type: 'value', message: this }))),
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
    if (this._subject) {
      this._subject.complete();
    }
    if (this._errors) {
      this._errors.complete();
    }
  }
}

proppify(ValueStream)
  .addProp('parent', null);

export default ValueStream;
