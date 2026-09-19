"use client";

import { useEffect, useState } from "react";
import type { CartItem } from "../_components/types";

// ตะกร้าสั่งผลิต — เก็บใน localStorage เพื่อใช้ร่วมกันระหว่างหน้า /production และ /production/cart
// (รอดจาก refresh หน้า และ sync ระหว่างหน้าด้วย custom event แบบเดียวกับ stockify-production-created)
const STORAGE_KEY = "stockify_production_cart";
export const CART_CHANGED_EVENT = "stockify-cart-changed";

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
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
export function updateCartQty(sku: string, qty: number) {
  const items = getCart();
  if (qty <= 0) {
    saveCart(items.filter((i) => i.bom.fg_sku !== sku));
    return;
  }
  saveCart(
    items.map((i) =>
      i.bom.fg_sku === sku
        ? { ...i, quantity: Math.max(1, Math.min(i.bom.maxProducible || 1, qty)) }
        : i
    )
  );
}

export function removeFromCart(sku: string) {
  saveCart(getCart().filter((i) => i.bom.fg_sku !== sku));
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
