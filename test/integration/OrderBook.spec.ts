import { expect } from 'chai';
import uuidv1 from 'uuid/v1';
import DB from '../../lib/db/DB';
import OrderBook from '../../lib/orderbook/OrderBook';
import OrderBookRepository from '../../lib/orderbook/OrderBookRepository';
import Logger, { Level } from '../../lib/Logger';
import { orders } from '../../lib/types';
import { SwapClients } from '../../lib/types/enums';
import { ms } from '../../lib/utils/utils';

const PAIR_ID = 'LTC/BTC';
const currencies = PAIR_ID.split('/');
const loggers = Logger.createLoggers(Level.Warn);

const createOwnOrder = (price: number, quantity: number, isBuy: boolean, createdAt = ms()): orders.OwnOrder => ({
  price,
  quantity,
  isBuy,
  createdAt,
  initialQuantity: quantity,
  id: uuidv1(),
  localId: uuidv1(),
  pairId: PAIR_ID,
  hold: 0,
});

const createPeerOrder = (
  price: number,
  quantity: number,
  isBuy: boolean,
  createdAt = ms(),
  peerPubKey = '029a96c975d301c1c8787fcb4647b5be65a3b8d8a70153ff72e3eac73759e5e345',
): orders.PeerOrder => ({
  quantity,
  price,
  isBuy,
  createdAt,
  peerPubKey,
  initialQuantity: quantity,
  id: uuidv1(),
  pairId: PAIR_ID,
});

const initValues = async (db: DB) => {
  const orderBookRepository = new OrderBookRepository(loggers.orderbook, db.models);

  await orderBookRepository.addCurrencies([
    { id: currencies[0], swapClient: SwapClients.Lnd, decimalPlaces: 8 },
    { id: currencies[1], swapClient: SwapClients.Lnd, decimalPlaces: 8 },
  ]);
  await orderBookRepository.addPairs([
    { baseCurrency: currencies[0], quoteCurrency: currencies[1] },
  ]);
};

describe('OrderBook', () => {
  let db: DB;
  let orderBook: OrderBook;

  before(async () => {
    db = new DB(loggers.db);
    await db.init();

    await initValues(db);
    orderBook = new OrderBook(loggers.orderbook, db.models);
    await orderBook.init();
  });

  const getOwnOrder = (order: orders.OwnOrder): orders.OwnOrder | undefined => {
    const ownOrders = orderBook.getOwnOrders(order.pairId);
    const arr = order.isBuy ? ownOrders.buy : ownOrders.sell;

    for (const orderItem of arr) {
      if (orderItem.id === order.id) {
        return orderItem;
      }
    }

    return;
  };

  it('should have pairs and matchingEngines equivalent loaded', () => {
    orderBook.pairs.forEach((pair) => {
      expect(orderBook.tradingPairs).to.have.key(pair.id);
    });
  });

  it('should append two new ownOrder', async () => {
    const order = { pairId: 'LTC/BTC', quantity: 5, price: 55, isBuy: true, hold: 0 };
    await orderBook.placeLimitOrder({ localId: uuidv1(), ...order });
    await orderBook.placeLimitOrder({ localId: uuidv1(), ...order });
  });

  it('should fully match new ownOrder and remove matches', async () => {
    const order = { pairId: 'LTC/BTC', localId: uuidv1(), quantity: 6, price: 55, isBuy: false, hold: 0 };
    const matches = await orderBook.placeLimitOrder(order);
    expect(matches.remainingOrder).to.be.undefined;

    const firstMatch = matches.internalMatches[0];
    const secondMatch = matches.internalMatches[1];
    expect(firstMatch).to.not.be.undefined;
    expect(secondMatch).to.not.be.undefined;

    const firstMakerOrder = getOwnOrder(<orders.OwnOrder>firstMatch);
    const secondMakerOrder = getOwnOrder(<orders.OwnOrder>secondMatch);
    expect(firstMakerOrder).to.be.undefined;
    expect(secondMakerOrder).to.not.be.undefined;
    expect(secondMakerOrder!.quantity).to.equal(4);
  });

  it('should partially match new market order and discard remaining order', async () => {
    const order = { pairId: 'LTC/BTC', localId: uuidv1(), quantity: 10, isBuy: false, hold: 0 };
    const result = await orderBook.placeMarketOrder(order);
    const match = result.internalMatches[0];
    expect(result.remainingOrder).to.be.undefined;
    expect(getOwnOrder(<orders.OwnOrder>match)).to.be.undefined;
  });

  it('should create, partially match, and remove an order', async () => {
    const order: orders.OwnOrder = createOwnOrder(10, 10, true);
    await orderBook.placeLimitOrder(order);
    const takerOrder: orders.OwnMarketOrder = { pairId: 'LTC/BTC', localId: uuidv1(), quantity: 5, isBuy: false, hold: 0 };
    await orderBook.placeMarketOrder(takerOrder);
    expect(() => orderBook.removeOwnOrderByLocalId(order.localId)).to.not.throw();
  });

  it('should not add a new own order with a duplicated localId', async () => {
    const order: orders.OwnOrder = createOwnOrder(100, 10, false);

    expect(orderBook.placeLimitOrder(order)).to.be.fulfilled;

    expect(orderBook.placeLimitOrder(order)).to.be.rejected;

    expect(() => orderBook.removeOwnOrderByLocalId(order.localId)).to.not.throw();

    expect(() => orderBook.removeOwnOrderByLocalId(order.localId)).to.throw();

    expect(orderBook.placeLimitOrder(order)).to.be.fulfilled;

    expect(orderBook.placeLimitOrder(order)).to.be.rejected;
  });

  after(async () => {
    await db.close();
  });
});

describe('nomatching OrderBook', () => {
  let db: DB;
  let orderBook: OrderBook;

  before(async () => {
    db = new DB(loggers.db);
    await db.init();
    await initValues(db);
  });

  beforeEach(async () => {
    orderBook = new OrderBook(loggers.orderbook, db.models, true);
    await orderBook.init();
  });

  it('should should not accept market orders', () => {
    const order = createOwnOrder(100, 10, true);
    expect(orderBook.placeMarketOrder(order)).to.be.rejected;
  });

  it('should accept but not match limit orders', async () => {
    const buyOrder = createOwnOrder(100, 10, true);
    const buyOrderResult = await orderBook.placeLimitOrder(buyOrder);
    expect(buyOrderResult.remainingOrder!.localId).to.be.equal(buyOrder.localId);
    expect(buyOrderResult.remainingOrder!.quantity).to.be.equal(buyOrder.quantity);

    const sellOrder = createOwnOrder(100, 10, false);
    const sellOrderResult = await orderBook.placeLimitOrder(sellOrder);
    expect(sellOrderResult.remainingOrder!.localId).to.be.equal(sellOrder.localId);
    expect(sellOrderResult.remainingOrder!.quantity).to.be.equal(sellOrder.quantity);
  });

  it('should not place the same order twice', async () => {
    const order = createOwnOrder(100, 10, true);
    expect(orderBook.placeLimitOrder(order)).to.be.fulfilled;
    expect(orderBook.placeLimitOrder(order)).to.be.rejected;
  });

  it('should not remove the same order twice', async () => {
    const order = createOwnOrder(100, 10, true);
    expect(orderBook.placeLimitOrder(order)).to.be.fulfilled;
    expect(() => orderBook.removeOwnOrderByLocalId(order.localId)).to.not.throw();
    expect(() => orderBook.removeOwnOrderByLocalId(order.localId)).to.throw();
  });

  it('should allow own order partial removal, but should not find the order localId after it was fully removed', async () => {
    const order = createOwnOrder(100, 10, true);
    const { remainingOrder } = await orderBook.placeLimitOrder(order);

    orderBook['removeOwnOrder'](remainingOrder!.id, order.pairId, remainingOrder!.quantity - 1);
    orderBook['removeOwnOrder'](remainingOrder!.id, order.pairId, 1);

    expect(() => orderBook['removeOwnOrder'](remainingOrder!.id, order.pairId, 1)).to.throw;
  });

  it('should allow own order partial removal, but should not find the order id after it was fully removed', async () => {
    const order = createOwnOrder(100, 10, true);
    const { remainingOrder } = await orderBook.placeLimitOrder(order);

    orderBook['removeOwnOrder'](remainingOrder!.id, order.pairId, remainingOrder!.quantity - 1);
    orderBook['removeOwnOrder'](remainingOrder!.id, order.pairId, 1);

    expect(() => orderBook['removeOwnOrder'](remainingOrder!.id, order.pairId, 1)).to.throw;
  });

  after(async () => {
    await db.close();
  });
});
