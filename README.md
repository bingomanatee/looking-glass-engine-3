# Looking Glass Engine 3.0

This is a rebuild of LGE 3; no backwards compatibility with 2.0 is delivered though an adaptive class might be added at 
some point. The goal of this rebuild is a smaller footprint more opinionated system with more dependency on streams
and the smallest possible dependency pool. 

## Why 

Redux is not good. It is difficult to test, has no schema
and is very verbose. Looking Glass Engine (or LGE) is succinct,
allows for schema constraints, and is far more flexible and easy to use.
   
# ValueStream public API

There is a fairly hefty load of code under the hood of a ValueStream; however you only
need about five hooks to use ValueStreams, which we present here. 

The assumption here is that you want to create a multi value stream -- that is a stream
with multiple values. 

## *constructor*

```javascript
const myStream = new ValueStream('streamName')
```
Even the name is optional; if you make the unwise decision to not name your stream
a name will be generated. 

## ValueStream methods

### method `property(name, value, type?)` : stream

Defines a mutable property and its initial value. returns the stream - so can be curried
#### parameter: name {string}

**required!* -- the name of the parameter; must be a valid javaScript property name - an underscore or letter
followed by zero or more letters, numbers or underscores. 

#### parameter: value {variant} 

**required** -- the initial value of the property. Even if you want to start a property as undefined,
pass undefined as a parameter (or better yet null). 

Note the initial value IS NOT VALIDATED BY TYPE! you can start a type-constrained
value to null as a hint to determine whether it is dirty. 

#### parameter: `type` {string} (optional)

You can constrain subsequent values to conform to the type which is in fact the name of a method of 
the (`is` library)[https://github.com/enricomarino/is] -- not to be mistaken for
`is.js` or `is_js`. these include the expected 'integer', 'number', 'bool', 'string',
'fn' etc.). If omitted, any value can be put into a property.

### method: `method(name, fn, transact)` : stream 

defines a managed action for the stream. 

#### property: name {string}

**required** -- the name of the method; must be a valid javaScript property name - an underscore or letter
                followed by zero or more letters, numbers or underscores. 

#### property: fn {function}

**required** -- a method that operates on stream. 

* This function is passed the stream as the first argument.
* Any subsequent variables follow. (and are optional)
* The returned value of the function is returned to the 
  calling context. It is not used by ValueStream itself,
  and you don't have to return any value from a method. 
* The method can be async or synchronous, lambda or function;
  the only constraint is that generators are not supported
  by ValueStream at this time. 
* You can call any methods (including your other methods)
  of the stream argument inside the body of a custom method.
* Errors - synchronous or asyncronous - are absorbed by the
  ValueStream. If you want to track errors, do so indirectly
  via the second argument to the `.subscribe(onNext, onError, onDone)`
  method of the ValueStream.
* you cannot re-define a method

#### property: transact {boolean} [default: false]

**optional** -- whether to delay broadcast of updates until
the method is complete. This reduces the "churn" of updates
that sub-calls would otherwise generate.

***WARNING:*** applying transactional constraints to asynchronous
methods -- or methods that await async calls or return promises --
will freeze up your stream until the resolution of the promise. 
(or an error is thrown.) Its better to call two transactional
methods, one before the promise and one upon its commencement,
to allow for the stream to operate between the initiation of 
a promise and the completion. 

*Calling a method*

Methods are added to the `.do` object of your value stream.
This is done to ensure the your methods don't conflict 
with any internal ValueStream code now or in the future. 

#### Usage Examples

```javascript
const { ValueStream } = require('./lib/index');

const coordinate = new ValueStream('coord')
  .property('x', 0, 'number')
  .property('y', 0, 'number')
  .method('add', (stream, x, y) => {
    stream.do.setX(x + stream.get('x'));
    stream.do.setY(y + stream.get('y'));
  }, true) // transactional
  .method('sub', (stream, x, y) => {
    stream.do.add(-x, -y);
    // note - even though sub is not transactional,
    // the sub-call to add WILL be transactional.
  })
  .method('scale', (stream, k) => {
    stream.do.setX(k * stream.get('x'));
    stream.do.setY(k * stream.get('y'));
  }, true)
  .method('normalize', (stream) => {
    const x = stream.get('x');
    const y = stream.get('y');
    const magnitude = Math.sqrt((x ** 2) + (y ** 2));
    if (magnitude === 0) {
      throw new Error('cannot normalize origin');
    }
    stream.do.scale(1 / magnitude);
  });

const sub = coordinate.subscribe(
  ({ value }) => {
    const { x, y } = value;
    console.log('x:', x, 'y:', y);
  },
  (err) => {
    console.log('error:', err);
  },
);

// 'x:', 0, 'y:', 0

coordinate.do.add(1, 2);

// 'x:', 1, 'y:', 2

coordinate.do.normalize();

// x: 0.4472135954999579 y: 0.8944271909999159

coordinate.do.scale(10);
// x: 4.47213595499958 y: 8.94427190999916

```

### method: `subscribe(onNext, onError, onDone)`
returns a Subscription object (with an `.unsubscribe()` method).

#### property: `onNext` {function}

onNext repeatedly gets the stream, every time a value is changed (or on completion
of a transaction). To get the current values, call the stream's `.value` property or 
`.toObject()` method - or better yet get select values manually. 

ValueStream always has a values, so immediately upon subscribing `onNext` should
get a value. 

#### property: `onError` {function}

This method emits a data burst when a function
escapes a method or a user attempts to call `myStream.do.set[property]` with a value
that violates its type constraint. note, in RXJS an error precedes the closing(completing)
of a stream. In ValueStream, OTOH, any number of errors can be emitted 

#### property: `onDone` {function}

called when a ValueStream is `complete()`d. It has no parameters. 

### method `complete()` :void

stops the ValueStream, preventing further data from being emitted. 

## Events

ValueStream is an event emitter as well. This is largely identical to 
the node eventEmitter pattern, but for economy of dependencies its 
implemented with streams.

Events are not data and don't have any direct coupling to the values 
ValueStream monitors. They exist to allow open/indirect coupling of methods
to situations; for instance, emitting a "sizeChange" event when
width or height change or emitting a derived value like the sum of 
an array property when its contents change.  
