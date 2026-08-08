/**
 * Typed Domain Errors for Stockify Inventory Operations
 */

export abstract class StockError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Validation error (400) - input schema or business constraint invalid
 */
export class StockValidationError extends StockError {
  readonly code = "STOCK_VALIDATION_ERROR";
  readonly statusCode = 400;
}

/**
 * Entity not found (404) - product, warehouse, location, or document not found
 */
export class StockNotFoundError extends StockError {
  readonly code = "STOCK_NOT_FOUND";
  readonly statusCode = 404;
}

/**
 * Insufficient stock balance (400) - requested quantity exceeds available stock
 */
export class InsufficientStockError extends StockError {
  readonly code = "INSUFFICIENT_STOCK";
  readonly statusCode = 400;
}

/**
 * Conflict error (409) - duplicate idempotency key or state conflict
 */
export class StockConflictError extends StockError {
  readonly code = "STOCK_CONFLICT";
  readonly statusCode = 409;
}

/**
 * Document already reversed (409)
 */
export class StockAlreadyReversedError extends StockError {
  readonly code = "STOCK_ALREADY_REVERSED";
  readonly statusCode = 409;
}

/**
 * Location invalid for warehouse (400)
 */
export class InvalidStockLocationError extends StockError {
  readonly code = "INVALID_STOCK_LOCATION";
  readonly statusCode = 400;
}

/**
 * Transfer document state does not allow requested action (409)
 */
export class InvalidTransferStateError extends StockError {
  readonly code = "INVALID_TRANSFER_STATE";
  readonly statusCode = 409;
}

/**
 * Unauthorized or forbidden stock operation (403)
 */
export class UnauthorizedStockOperationError extends StockError {
  readonly code = "UNAUTHORIZED_STOCK_OPERATION";
  readonly statusCode = 403;
}
