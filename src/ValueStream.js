/* eslint-disable no-param-reassign */
import { proppify } from '@wonderlandlabs/propper';
import { BehaviorSubject, Subject, merge } from 'rxjs';
import { map, combineAll } from 'rxjs/operators';
import is from 'is';
import _ from 'lodash';

const ABSENT = Symbol('ABSENT');
const has = (v) => v && (v !== ABSENT);
const propRE = /^[\w_][\w_\d]*$/;

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
      this._subject = new BehaviorSubject(this.value);

      if (type && (!(type === ABSENT))) {
        if (!is.string(type)) {
          throw new Error(`bad type value for ${name}: ${type}`);
        }
        this._type = type;
      }
    } else {
      this._subject = new BehaviorSubject(this);
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
  }

  get children() {
    if (!this._children) {
      this._children = new Map();
    }
    return this._children;
  }

  add(name, value, type = ABSENT) {
    if (this.isSingleValue) {
      throw new Error('cannot add sub-streams to stream with an single value');
    }

    const subStream = new ValueStream(name, value, type);
    subStream.parent = this;
    this.children.set(name, subStream);

    // cascade child errors and updates to parents streams
    subStream.subscribe(() => {
      this.next(this);
    }, (error) => {
      this.emitError({
        child: name,
        error,
      });
    });

    return this;
  }

  set(alpha, beta) {
    if (this.isSingleValue) {
      this.next(alpha);
    } else if (!this.children.has(alpha)) {
      console.log('attempt to set unknown child value', alpha, 'with', beta);
    } else {
      this.children.get(alpha).set(beta);
    }
    return this;
  }

  /* ---------------------- Methods ------------------------ */
  /**
   * A curried method to define an action.
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
    if (!is.func(fn)) {
      throw new Error('define requires a function as the second parameter');
    }
    if (this._actions.has(actionName)) {
      console.log(this.name, 'already has an action ', actionName);
      return this;
    }

    this._actions.set(actionName, this.actionFactory(actionName, fn, transact));
    this.do[actionName] = this._actions.get(actionName);

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
      if (is.func(fn)) {
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

  next(value = ABSENT) {
    if (!this.isSingleValue) {
      this._subject.next(this);
      return;
    }
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
    this._subject.next();
  }

  error(error) {
    this.emitError({ error });
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
