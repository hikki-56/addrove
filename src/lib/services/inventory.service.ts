import type { IStockRepository } from "@/lib/repositories/interfaces";
import type {
  ReceiveInput,
  IssueInput,
  MoveInput,
  TransferInput,
  ReversalInput,
} from "@/lib/repositories/interfaces";
import type { Document } from "@/types/models";

import {
  receiveStock,
  issueStock,
  moveStock,
  createTransfer,
  completeTransfer,
  cancelTransfer,
  reverseStock,
  getStockBalances,
  matchSku,
  cleanSkuCode,
  cleanLocCode,
  findWarehouse,
} from "./stock";

export * from "./stock";

/**
 * Backward compatibility facade delegating to modular stock use cases.
 */
export class InventoryService {
  constructor(private readonly repo: IStockRepository) {}

  async receive(input: ReceiveInput): Promise<Document> {
    return receiveStock({ repo: this.repo }, input);
  }

  async issue(input: IssueInput): Promise<Document> {
    return issueStock({ repo: this.repo }, input);
  }

  async move(input: MoveInput): Promise<Document> {
    return moveStock({ repo: this.repo }, input);
  }

  async transfer(input: TransferInput): Promise<Document> {
    return createTransfer({ repo: this.repo }, input);
  }

  async completeTransfer(
    docId: string,
    toLocationId?: string,
    userId?: string
  ): Promise<Document> {
    return completeTransfer({ repo: this.repo }, docId, toLocationId, userId);
  }

  async cancelTransfer(
    docId: string,
    note?: string,
    userId?: string
  ): Promise<Document> {
    return cancelTransfer({ repo: this.repo }, docId, note, userId);
  }

  reversal = async (input: ReversalInput): Promise<Document> => {
    return reverseStock({ repo: this.repo }, input);
  };

  async reverseMovement(input: ReversalInput): Promise<Document> {
    return reverseStock({ repo: this.repo }, input);
  }

  async getStockBalance(warehouseId?: string) {
    return getStockBalances({ repo: this.repo }, warehouseId);
  }
}

export {
  matchSku,
  cleanSkuCode,
  cleanLocCode,
  findWarehouse,
};
