import is from 'is';

export default (type, name, throwIfBad) => {
  if (!type) {
    return () => false;
  }

  if (is.function(type)) {
    return type;
  }

  if (is.string(type)) {
    if (is[type]) {
      return (value) => {
        if (!is[type](value)) {
          return `${name} must be a ${type}`;
        }
        return false;
      };
    }
    console.log(`typeTestError: cannot find is fn ${type}`);

    if (throwIfBad) {
      throw new Error(`cannot find function ${type} in is`);
    }
  }
  return () => false;
};
