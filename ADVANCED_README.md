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

*Note - its a fairly easy task to use streams with hooks. So easy that I'm not going to 
patronise you by showing you how to do it.*

## constructor

note - you can return a single-value valueStream
by calling `new ValueStream('count', 0, 'number')`.

You can't add properties to a single-value stream,
but you can add methods. 

### method `property(name, value, type?)` : stream

Fun fact: properties in fact define single-value 
streams that are stored in a map of the parent value stream.

### method: `method(name, fn, transact)` : stream 

If you want to redefine/decorate/introspect
on the `._methods` property(a Map).

* `this` doesn't have any defined meaning and should not 
  be used inside a method's function. 

## property: my 

This is a proxy getter where Proxies are available. The efficiency of .my as a property
is it allows you to pluck a single sub-value without serializing the entire tree. 
`myStrem.value.foo` serializes the entire collection which is a waste when only one subelement 
is desired. 

Where they are not (i.e., IE), and for single value streams, property.my is the same as 
property.value.
