import { db } from '../types';
import Bluebird from 'bluebird';
import { Models } from '../db/DB';

class SwapRepository {

  constructor(private models: Models) {}

  public getSwapDeals = (): Bluebird<db.SwapDealInstance[]> => {
    return this.models.SwapDeal.findAll();
  }

  public getSwapDeal = async (rHash: string): Promise<db.SwapDealInstance | null> => {
    return this.models.SwapDeal.findOne({
      where: {
        rHash,
      },
    });
  }

  public addSwapDeal = async (swapDeal: db.SwapDealFactory): Promise<db.SwapDealInstance> => {
    const node = await this.models.Node.findOne({
      where: {
        nodePubKey: swapDeal.peerPubKey,
      },
    });
    const attributes = { ...swapDeal, nodeId: node!.id } as db.SwapDealAttributes;
    return this.models.SwapDeal.create(attributes);
  }
}
export default SwapRepository;
