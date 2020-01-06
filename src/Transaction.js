import { proppify } from '@wonderlandlabs/propper';
import _ from 'lodash';

let id = null;
class Transaction {
  constructor({ name, params, target }) {
    this.name = name;
    this.target = target;

    if (params) this.params = params;
    this.id = `${id}-${Date.now()}`;
    id += 1;
  }

  complete() {
    try {
      this.open = false;
      this.target.closeTransaction(this);
    } catch (error) {
      console.log('Transaction complete error: ', this, error);
    }
  }

  toString() {
    return `transaction ${this.name}, params: ${JSON.stringify(this.params)}, target: ${this.target.name}`;
  }
}

proppify(Transaction)
  .addProp('method', '', 'string')
  .addProp('open', true, 'boolean')
  .addProp('id')
  .addProp('target')
  .addProp('params');

export default Transaction;
