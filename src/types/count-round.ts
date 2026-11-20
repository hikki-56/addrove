export interface CountRound {
  round_id: string;
  opened_at: string;
  closed_at: string | null;
  opened_by: string;
}

export interface CountProduct {
  product_id: string;
  sku: string;
  product_name: string;
  base_unit: string;
}

export interface CountEntry extends CountProduct {
  request_id: string;
  shelf_code: string;
  quantity: number;
  counter_name: string;
  counted_at: string;
}

export interface CountShelf {
  shelf_code: string;
  counted_by: string;
  counter_name: string;
  occupied: boolean;
  finished_at: string | null;
}

export interface RoundReport {
  round: CountRound;
  shelves: CountShelf[];
  entries: CountEntry[];
}
