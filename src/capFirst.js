import is from 'is';

function capFirst(string, prefix) {
  if (prefix) return prefix + capFirst(string);
  if (!(string && is.string(string))) {
    throw new Error(`capFirst: bad input ${string}`);
  }
  return string[0].toUpperCase() + string.slice(1);
}

export default capFirst;
