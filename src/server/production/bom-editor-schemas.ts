import { z } from "zod";

export const bomEditorItemSchema = z.object({
  item_id: z.number().int().positive().optional(),
  sku: z.string().trim().min(1).max(100),
  name: z.string().optional(),
  qty: z.number().positive().finite(),
  unit: z.string().trim().min(1).max(50),
  waste_percentage: z.number().min(0).max(100),
  is_primary: z.union([z.literal(0), z.literal(1)]),
});

const formulaFields = {
  unit: z.string().trim().min(1).max(50),
  base_qty: z.number().positive().finite(),
  items: z.array(bomEditorItemSchema).min(1).max(200),
};

export const bomEditorUpdateSchema = z.object({
  bom_id: z.string().min(1).max(100),
  revision: z.string().min(1).max(100),
  ...formulaFields,
});

export const bomManagementCreateSchema = z.object({ product_id: z.string().min(1).max(100), ...formulaFields });
export const bomManagementUpdateSchema = bomEditorUpdateSchema.extend({ product_id: z.string().min(1).max(100) });
export const bomManagementDeleteSchema = z.object({
  product_id: z.string().min(1).max(100),
  bom_id: z.string().min(1).max(100),
  revision: z.string().min(1).max(100),
});
