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
