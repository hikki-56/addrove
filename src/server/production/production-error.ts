export class ProductionError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "ProductionError";
  }
}
