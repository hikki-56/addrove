"use client";

import { useEffect, useState } from "react";
import type { CartItem } from "../_components/types";

// ตะกร้าสั่งผลิต — เก็บใน localStorage เพื่อใช้ร่วมกันระหว่างหน้า /production และ /production/cart
// (รอดจาก refresh หน้า และ sync ระหว่างหน้าด้วย custom event แบบเดียวกับ stockify-production-created)
const STORAGE_KEY = "stockify_production_cart";
export const CART_CHANGED_EVENT = "stockify-cart-changed";

/** จำนวนโต๊ะผลิตของโรงงาน */
export const PRODUCTION_TABLE_COUNT = 5;

/** โต๊ะผลิตทั้งหมด (1–5) */
export const PRODUCTION_TABLES = Array.from({ length: PRODUCTION_TABLE_COUNT }, (_, i) => i + 1);

/** โต๊ะที่ถูกต้องอยู่ในช่วง 1–5 */
export function normalizeTableNo(tableNo: number | undefined | null): number {
  const n = Math.floor(Number(tableNo) || 0);
  if (!PRODUCTION_TABLES.includes(n)) return 1;
  return n;
}

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // ตะกร้าเก่าก่อนมีระบบโต๊ะไม่มี table_no — จัดเข้าโต๊ะ 1 ให้อัตโนมัติ
    return (parsed as CartItem[]).map((i) => ({ ...i, table_no: normalizeTableNo(i?.table_no) }));
  } catch {
    return [];
  }
}

function saveCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
}

export function setCart(items: CartItem[]) {
  saveCart(items);
}

/** ปรับจำนวน — ถ้า qty <= 0 ถือว่าลบรายการออก (clamp ตาม maxProducible ที่บันทึกไว้ตอนเพิ่ม) */
export function updateCartQty(tableNo: number, sku: string, qty: number) {
  const items = getCart();
  if (qty <= 0) {
    saveCart(items.filter((i) => !(i.table_no === tableNo && i.bom.fg_sku === sku)));
    return;
  }
  saveCart(
    items.map((i) =>
      i.table_no === tableNo && i.bom.fg_sku === sku
        ? { ...i, quantity: Math.max(1, Math.min(i.bom.maxProducible || 1, qty)) }
        : i
    )
  );
}

export function removeFromCart(tableNo: number, sku: string) {
  saveCart(getCart().filter((i) => !(i.table_no === tableNo && i.bom.fg_sku === sku)));
}

/**
 * ย้ายรายการไปอีกโต๊ะ — ถ้าปลายทางมีสินค้าเดียวกันอยู่แล้วให้รวมยอดเข้าด้วยกัน
 * (คืน false ถ้ารวมแล้วเกิน maxProducible และไม่ได้ย้าย)
 */
export function moveCartItem(fromTable: number, sku: string, toTable: number): boolean {
  const target = normalizeTableNo(toTable);
  const items = getCart();
  const source = items.find((i) => i.table_no === fromTable && i.bom.fg_sku === sku);
  if (!source || target === fromTable) return false;

  const dest = items.find((i) => i.table_no === target && i.bom.fg_sku === sku);
  if (dest) {
    const merged = dest.quantity + source.quantity;
    if (merged > (source.bom.maxProducible || 1)) return false;
    saveCart(
      items
        .filter((i) => i !== source)
        .map((i) => (i === dest ? { ...i, quantity: merged } : i))
    );
    return true;
  }

  saveCart(items.map((i) => (i === source ? { ...i, table_no: target } : i)));
  return true;
}

export function clearCart() {
  saveCart([]);
}

/** ฟังการเปลี่ยนตะกร้า (เรียกทุกครั้งที่มีการ save) */
export function subscribeCart(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener(CART_CHANGED_EVENT, handler);
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener(CART_CHANGED_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
}

/** Hook ดึงตะกร้าแบบ real-time (อ่านหลัง mount เพื่อเลี่ยง hydration mismatch) */
export function useProductionCart(): CartItem[] {
  const [cart, setCart] = useState<CartItem[]>([]);
  useEffect(() => {
    setCart(getCart());
    return subscribeCart(() => setCart(getCart()));
  }, []);
  return cart;
}
