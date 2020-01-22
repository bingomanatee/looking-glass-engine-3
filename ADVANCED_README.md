# Looking Glass Engine 3.0

Advanced notes:

## Why

Redux has several qualities I find disturbing and limiting:

1. **Redux does not have schema.** Filtering values by type and tracking 
   bad values is left to the application designer, which I feel is a major
   abdication of responsibility.
2. **Redux is criminally verbose.** The amount of typing required to create 
   a single store with a single value and an update method is astounding - 
   on the order of 50 lines. in LGE by contrast you can do it in under 5 lines

```javascript

const singleValueStore = new ValueStore('count', 0, 'number');

// this is the adapative code to simply track change:
singleValueStore.subscribe((stream) => { console.log(stream.name, ':', stream.value)});
// 'count' ':', 0
singleValueStore.set(2);
// 'count', ':', 2
```

or, to set a single property of a multi-property stream: 

```javascript
const singleValueStore = new ValueStore('counts').property('visits', 0, 'number')

// this is the code to simply track a property:
singleValueStore.subscribe((stream) => { console.log('visits:', stream.get('visits'))});
// 'visits:', 0
singleValueStore.do.setVisits(2)
// visits:', 2;
```

3. **Redux forces a top down state.** It is difficult to create a local state
   and scope it to one (or one branch) of views. The assumption is that there is a 
   global state and every component can/should point to the externally defined state
   to do its business; if you want local state you use hooks, state, and/or context.
   All three of these are workable but problematic in different ways, the least of which
   is that you end up writing app state in one format for the global state and another
   for the local state, and that it puts state in a place that makes unit testing problematic.
4. **Redux is hard to test.** LGE is a self-contained state instance that can be
   tested without relying on any arcane testing framework - in fact it can be tested
   without JSX, React; like RXJS it is not written with a commitment any specific view target.
   The internal unit tests of LGE are done in TAP Test framework, and without any
   React inclusions. 
 5. **The `connect(...)` convention adds a level of obscurity to application design.** You can
   rename actions, combine or mutate values or put derived values in the connect handlers,
   making the link between the actions and your views' methods difficult to trace. LGE
   by contrast has singular names that are directly referenced a la `myStream.do.myMethod(value)`
   so it is always clear which method is being triggered and where you have to look 
   if there are errors
 6. **Redux promotes frequent refreshing of state.** Because every action triggers
   a data flush to the view layer, it is difficult to define an method that triggers
   several actions without also triggering several refreshes of state to the view layer.
   LGE on the other hand lets you bind several actions to a single update action through 
   transactions, which delay publication til a method completes, even if you call several
   other methods and/or update the value of several properties inside the method body. 

LGE on the other hand:

1. **Is based on one - or more - instances with methods and properties.** LGEs are 
   Observables but they also follow a relatively standard Object pattern; you can 
   define properties with names -- `myStream.property('count', 0, 'number')` 
   and get and set them with simple`.get('name')` and `.set(name, value)` calls. 
   Similarly complex methods can be defined easily:
```javascript

const visits = new ValueStore('counts').property('visits', 0, 'number')
visits.subscribe((stream) => { console.log('visits:', stream.get('visits'))});
// console.log('visits:', 0);
visits.method('addToVisits', (stream, value) => {
 stream.do.setVisits(stream.get('count') + value);
});

visits.do.addToVisits(3);
// console.log('visits:', 3);
```

2. **Linking LGE to React uses standard observable patterns.** ValueStreams 
   can be defined inside or externally to a React Component. As such, one or more
   React Components can share a view (say, for user management) or not (as a replacement
   for setState). 
   In both cases adapting the stream to a view is fundamentally the same:


### Design philosophy

Value stream is based on these fundamental ideas:

1. Value streams both generate and track changes in one or multiple values.
2. Subscriptions update when a change is made unless transactional locking is in place
3. higher level methods can trigger change and other methods to orchestrate updates on the stream
4. ValueStreams enforce a closed schema of properties that can be individually 

ValueStreams are recursive; that is the same class that defines a collection of data
defines the management of a single piece of data. At this point no testing has been done on 
more than one level of recursion. 

It follows the RxJS Observable pattern; state updates can be `.subscribe(change, error, done)` to.
 
They also express OOP patterns with methods and properties. ValueStream instances have:
* `set(value)` or `.set(propertyName, value)` setters
* `get()` or `get(propertyName)` getters for value access. 
* a `do` property that exposes custom methods: `stream.do.customMethod(...)`. 

Custom methods can be synchronous or asynchronous. You can suppress mid-stage changes
by adding transactional locking when defining the method. 

Because ValueStreams are driven by change notifications, you can observe
individual properties directly. 
* `.watch(propertyName, onChange, onError, onDone)` passes an object with a signature `{value, prev, name}`
to onChange. 
* `.watchFlat(propertyName, (value, prev) => {...}, onError, onDone)` extends value and prev into 
parameters.

### shared state

```javascript

import React, {Component} from 'react';
import userStream from './../state/user.store.js';

const UserTag = ({user, onClick}) => (
<>
<b>{user.name}<b>
<button onClick={onClick}>Log Out</button>
</> 
);

const NoUserTag = ({onClick}) => (
<button onClick={onClick}>Log In</button>
);

class Header extends Component {

   constructor(params) {
      super(params);
      this.state = {...userStream.value};
   }

   componentDidMount(){
      this._sub = userStream.subscribe(
      (stream) => { this.setState(stream.value)}, 
      (err) => {console.log('Header:error in user state', err)});
   }
   componentWillUnmount() { this._sub.unsubscribe() }

   render() {
     const {user} = this.state;
     // you can pull values from this.state OR userStream; they should be the same at this point
     return (
     <div>
     {user ? <UserTag user={user} onClick={userStream.do.logOut} />
           : <NoUserTag onClick={userStream.do.logIn} />}
        </div>
    )
   }
}

```

### unique state

```javascript

import React, {Component} from 'react';
import {ValueStream} from '@wonderlandlabs/looking-glass-engine'

const colorString = (r,g,b) => 'rgb(' + r + ',' + g + ',' + b + ')';

class ColorPicker extends Component {

   constructor(params) {
      super(params);
      this.store = new ValueStream('color')
        .property('red', 0, 'integer')
        .property('green', 0, 'integer')
        .property('blue', 0, 'integer');

      this.onRange = this.onRange.bind(this);
      this.state = {...this.store.value};
   }

   componentDidMount(){
      this._sub = userStream.subscribe(
      (stream) => { this.setState(stream.value)}, 
      (err) => {console.log('Header:error in user state', err)});
   }
   componentWillUnmount() { this._sub.unsubscribe() }

   onRange(field, e) {
      this.store.set(field, Number.parseInt(e.target.value, 10));
   }

   render() {
     const {red, green, blue} = this.state;
     // you can pull values from this.state OR userStream; they should be the same at this point
     return (
     <section>
        <h2>Choose Color</h2>
        <dl>
        <dt>Red</dt>
        <dd><input type="range"
             min={0} max={255} value={red} 
              onChange={(e) => this.onRange('red', e)} />
        </dd>
        <dt>Green</dt>
        <dd><input type="range"
             min={0} max={255} value={red} 
              onChange={(e) => this.onRange('green', e)} />
        </dd>
        <dt>Blue</dt>
        <dd><input type="range"
             min={0} max={255} value={red} 
              onChange={(e) => this.onRange('blue', e)} />
        </dd>
        </dl>
        <h3>Sample:</h3>
        <div style={({ backgroundColor: colorString(red, green, blue)  color: 'gray'  })}>
         {colorString(red, green, blue)}
       </div>
     </section>
    )
   }
}

```

*Note - its a fairly easy task to use streams with hooks. 
So easy that I'm not going to patronise you by showing you how to do it.*

## constructor

note - you can return a single-value valueStream
by calling `new ValueStream('count', 0, 'number')`.

You can't add properties to a single-value stream,
but you can add methods. 

## ValueStream methods

### method: `property(name, value, type?)` : stream

Fun fact: properties in fact define single-value 
streams that are stored in a map of the parent value stream.

you can in fact pass a valueStream as the sole property, or the value,
to this method to create a deeply nested property series; this has 
not been deeply tested but it is possible in theory. 

### method: `propertyRange(name, value, params = { min: number = Number.NEGATIVE_INFINITY, max: number = Number.POSITIVE_INFINITY, type: string = 'number'}):ValueStream

creates a property (like the method above) that is a numeric value that is clamped between
the minimum and maximum range of the third argument. you don't have to define **BOTH**
`min` and `max`; though if you don't define *either* you probably
want to use the regular `property(name, value, type)` method.
If you don't define `type` its assumed to be 'number'; 'integer' is valid as well.

One fun fact: the *initial* value of the property defined with propertyRange is clamped to
be within the min/max range that the params define, so it may not be the one you feed to the `propertyRange` method. 

### method: `watch(name: string, onChange: fn, onError:fn, , onDone: fn)` : ValueStream

This special subscription focuses on change to a single value; onChange receives an object `{value, prev}`
every time its value is changed.

A variant of this  method, `watchFlat('name', (value, prev) => {...})` 
passes two arguments, the current and previous value, for each change.

watch also accepts a string that is the name of a method as a second argument as in
`myStream.watch('x', 'calcDistance).watch('y', 'calcDistance')`. 

### method: `method(name, fn, transact)` : stream 

If you want to redefine/decorate/introspect
on the `._methods` property(a Map).

* `this` doesn't have any defined meaning and should not 
  be used inside a method's function. 

### broadcast(changedFieldName: string)

methods do not *automatically* trigger updates to subscribers.
*changes* to watched values trigger updates. specifically 
setting a value to a streams' property. This means that simply
modifying an array or object stored in a property will not
trigger a change to listeners; its up to you to tell subscribers
that a complex property has been modified. 

the broadcast method does that. 

note - in many cases using immutable strategies -- cloning
the complex object and setting the property to the clone --
may be healthier for downstream observation; but in cases 
where you are storing complex object with references that 
make them difficult to clone broadcast gives you the option
of pushing changes to subscribers yourself. 

```javascript
  const arrayStream = new ValueStream('arrayStream')
    .property('list', [])
    .method('push', (s, v) => {
      s.my.list.push(v);
    })
    .method('pushBroadcast', (s, v) => {
      s.do.push(v);
      s.broadcast('list');
    });

  const changes = monitorMulti(arrayStream);
  arrayStream.subscribe(({ value }) => {
    console.log('values', JSON.stringify(value));
  });

  arrayStream.do.push(1);
  arrayStream.do.push(2);
  arrayStream.do.push(3);
  arrayStream.do.pushBroadcast(4);
  arrayStream.do.push(5);

/*
-- triggered by the creation of the subscription
values {"list":[]}
-- triggered by the lone call to pushBroadcast
values {"list":[1,2,3,4]}
*/

```

### method `filtered(propName:str...propName:str) : ValueStream`

Creates a ValueStream that has as its property a subset of the
properties defined in the source ValueStream. The returned ValueStream
will respond ONLY to changes on the watched properties. This is useful
if you want to watch to a targeted set of properties. 

```javascript

      const baseStream = new ValueStream('abcd')
        .property('a', 1)
        .property('b', 2)
        .property('c', 3)
        .property('d', 4)
        .method('addAll', (s, n) => {
          s.do.setA(s.my.a + n);
          s.do.setB(s.my.b + n);
          s.do.setC(s.my.c + n);
          s.do.setD(s.my.d + n);
        }, true);

      const filteredStream = baseStream.filtered('a', 'd');
      filteredStream.subscribe(({value}) => {console.log(value);});

      // #1 set an unfilterd value
      baseStream.do.setB(5);

      // #2 set a filtered value

      baseStream.do.setA(10);

      // #3 testing watching a transcription locked action

      baseStream.do.addAll(5);

/**
 -- broadcast immediately on subscription
 filtered update: { a: 1, d: 4 }
 -- broadcast after #2
 filtered update: { a: 10, d: 4 }
 -- broadcast after #3
 filtered update: { a: 15, d: 9 }

*/

```

note in the above example only two of the three actions 
on the source stream trigger messages. action #1 is ignored
by the subscription. Also addAll is transcription locked so 
act 3 only triggers a single update in the filtered stream.

`filtered(..)` returns a full and complete ValueStream;
its properties are *the same* as the sources' - changing 
a filtered ValueStream's property values will change the parents'
value! 

The filtered stream does not have any methods; 
It is not good practice to add any methods to the returned
stream or do anything other than subscribing to it.  

## Properties
### property: my 

This is a proxy getter where Proxies are available. The efficiency of .my as a property
is it allows you to pluck a single sub-value without serializing the entire tree. 
`myStrem.value.foo` serializes the entire collection which is a waste when only one subelement 
is desired. 

Where they are not (i.e., IE), and for single value streams, property.my is the same as 
property.value.

## Events
### `on(triggerName, (stream, value) => {...})`
### `emit(triggerName, value)`

ValueStream is an event emitter. 
They exist to allow open/indirect coupling of methods
to situations; for instance, emitting a "sizeChange" event when
width or height change or emitting a derived value like the sum of 
an array property when its contents change. 

Events are useful when you want one (or many) methods/computations
to trigger when one or more than one property change; for instance,
in a form stream, if you want to re-validate the entire form if any
field changes. 

The value emitted is up to the user to define - you don't actually
have to emit any specific value, or care what value is emitted;
also, you can emit more than one value.

Lastly, you can hook an emitted event directly to a method.
As an alternative to the below pattern, you could achieve the same 
aim by calling `.on('pointsChanged', 'calcDistance')`.

in the example below we use events to trigger/observe when
any point has changed. 

````javascript

      const segment = new ValueStream('segment')
        .property('x1', 0, 'number')
        .property('y1', 0, 'number')
        .property('x2', 0, 'number')
        .property('y2', 0, 'number')
        .property('distance', 0, 'number')
        .method('setP1', (s, x, y) => {
          s.do.setX1(x);
          s.do.setY1(y);
        }, true)
        .method('setP2', (s, x, y) => {
          s.do.setX2(x);
          s.do.setY2(y);
        }, true)
        .method('calcDistance', (s) => {
          const xdSquared = (s.my.x1 - s.my.x2) ** 2;
          const ydSquared = (s.my.y1 - s.my.y2) ** 2;
          s.do.setDistance(Math.sqrt(xdSquared + ydSquared));
        })
        .watchFlat('x1', (s) => {
          s.emit('pointsChanged');
        })
        .watchFlat('y1', (s) => {
          s.emit('pointsChanged');
        })
        .watchFlat('x2', (s) => {
          s.emit('pointsChanged');
        })
        .watchFlat('y2', (s) => {
          s.emit('pointsChanged');
        })
        .on('pointsChanged', (ss) => {
          ss.do.calcDistance();
        });

      segment.subscribe((s) => {
        console.log('distance is now:', s.my.distance);
      });

      segment.do.setP1(2, 4);
      segment.do.setP2(10, 10);

/**
distance is now: 0
distance is now: 4.47213595499958
distance is now: 10
*/

```` 
