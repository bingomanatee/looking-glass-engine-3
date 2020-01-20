/* eslint-disable no-param-reassign */
import React from 'react';
import lodashIsEqual from 'lodash.isequal';

function toProps(stream) {
  return { ...stream.value };
}

/**
 * This is a higher order component for a state that has a lifespan outside of the view.
 * This can be a globally included state that is shared through multiple inputs.
 *
 * @param View {React Component}
 * @param stream {ValueStream}
 * @param MyReact {React} an optional standin if a non-standard react is used (Preact). Must have a PureComponent property.
 * @param streamToProps {function(stream, props) : {Object}} deconstructs the current stream state into an object suitable for stte
 * @param ignoreProps {boolean} set to true to ignore the input of props into streamToProps. Disables compooentDidUpdate listener.
 * @param compareProps {function} optional; during the componentDidUpdate listener, analyzes the property difference to deterine whether another state message should be issued.
 * @returns {PureComponent}
 */
export const hoc = ({
  View, stream, React: MyReact = null, streamToProps = toProps, ignoreProps = false, compareProps = null,
}) => class LGEComponent extends (MyReact || React).PureComponent {
  constructor(p) {
    super(p);
    this.state = streamToProps(stream, p);
  }

  componentDidMount() {
    this._sub = stream.subscribe((theStream) => this.setState(streamToProps(theStream, this.props)));
  }

  componentDidUpdate(prevProps) {
    if (ignoreProps) return;
    if (!((compareProps || lodashIsEqual)(prevProps, this.props))) {
      this.setState(streamToProps(stream, this.props));
    }
  }

  render() {
    // note - we could use state in this case instead of re-callingn streamToProps.
    // eslint-disable-next-line react/jsx-props-no-spreading
    return <View {...this.props} {...streamToProps(stream, this.props)} />;
  }
};

/**
 * This method is intended to be called in a react components' constructor.
 * the return value should be merged with the component with object.assign.
 *
 * ALTERNATE: Tactical application of output
 *
 * If for some reason you want to combine the output more tactically at the very least
 * you'll want to assign state to the target's state.
 *
 * you can store the output and call componentDidMount/componentWillUnmount.
 *
 * You will also want to store the stream itself if you want access to its methods.
 *
 * @param streamFactory {function} a factory to produce a ValueStream; Expects (props, target)
 * @param stateFactory {function} a function that given the stream and current props, returns the next value for state.
 *                     optional; if absent, will return the entire value object. expects(stream, props);
 * @param initialProps the initial properties at the time of invocation; the props argument to constructor.
 * @param target {Component} the react component itself.
 * @param mountedProp {string} the name for the parameter in which to state the mounted flag in target.
 * @returns {{stream: *, componentWillUnmount: componentWillUnmount, state: *, componentDidMount: componentDidMount}}
 */
export const injectLocalState = ({
  streamFactory, stateFactory, initialProps = {}, target, mountedProp = 'isMounted', initialState = {},
}) => {
  if (!stateFactory) {
    stateFactory = ({ value }) => value;
  }

  const stream = streamFactory(initialProps, target);
  const state = Object.assign(initialState, stateFactory(stream, initialProps));

  const localCDM = (target.componentdDidMount) || (() => {});
  const localCWU = (target.componentWillUnmount) || (() => {});

  const subName = `_sub_${Math.random()}`.replace('.', '_');
  const componentDidMount = function () {
    target[subName] = stream.subscribe(
      (stream) => {
        if (target[mountedProp]) {
          target.setState(stateFactory(stream, target.props));
        }
      },
      (error) => console.log('error on ', stream.name, error, 'in', target.name || 'React component'),
    );
    target[mountedProp] = true;
    localCDM.call(target);
  };

  const componentWillUnmount = function () {
    if (target[subName]) target[subName].unsubscribe();
    target[mountedProp] = false;
    localCWU.call(target);
  };

  return {
    state, stream, componentDidMount, componentWillUnmount,
  };
};
