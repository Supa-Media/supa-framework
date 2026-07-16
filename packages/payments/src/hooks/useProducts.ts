/**
 * useProducts — Available products and prices.
 *
 * Wraps a Convex query that returns product/price data from your backend.
 * The consumer app provides the raw query result; this hook normalizes
 * the data into a standard UseProductsResult.
 */

import { useMemo } from "react";
import type { Product, Price, UseProductsResult } from "../types/index.js";

/**
 * Raw product data shape from a Convex query.
 * Intentionally loose to support different backend schemas.
 */
interface RawProduct {
  id?: string;
  _id?: string;
  name: string;
  description?: string;
  active?: boolean;
  metadata?: Record<string, string>;
  prices?: RawPrice[];
}

interface RawPrice {
  id?: string;
  _id?: string;
  productId?: string;
  unitAmount?: number;
  unit_amount?: number;
  amount?: number;
  currency?: string;
  interval?: string | null;
  recurring?: { interval?: string } | null;
  active?: boolean;
}

/**
 * Hook to get available products and their prices.
 *
 * @param queryResult - The result from a `useQuery()` call to your products
 *   query. Pass `undefined` while loading, or an array of product objects.
 *
 * @example
 * ```tsx
 * import { useQuery, api } from "../convex/_generated";
 * import { useProducts } from "@supa-media/payments/hooks";
 *
 * function PricingPage() {
 *   const data = useQuery(api.payments.listProducts);
 *   const { products, isLoading } = useProducts(data);
 *
 *   if (isLoading) return <Loading />;
 *   return products.map(p => <PlanCard key={p.id} product={p} />);
 * }
 * ```
 */
export function useProducts(
  queryResult: RawProduct[] | null | undefined
): UseProductsResult {
  return useMemo(() => {
    if (queryResult === undefined) {
      return { products: [], isLoading: true };
    }

    if (queryResult === null || queryResult.length === 0) {
      return { products: [], isLoading: false };
    }

    const products = queryResult.map((raw): Product & { prices: Price[] } => {
      const prices = (raw.prices ?? []).map(
        (rp): Price => ({
          id: rp.id ?? rp._id ?? "",
          productId: rp.productId ?? raw.id ?? raw._id ?? "",
          unitAmount: rp.unitAmount ?? rp.unit_amount ?? rp.amount ?? 0,
          currency: rp.currency ?? "usd",
          interval: normalizeInterval(
            rp.interval ?? rp.recurring?.interval ?? null
          ),
          active: rp.active ?? true,
        })
      );

      return {
        id: raw.id ?? raw._id ?? "",
        name: raw.name,
        description: raw.description,
        active: raw.active ?? true,
        metadata: raw.metadata ?? {},
        prices,
      };
    });

    return { products, isLoading: false };
  }, [queryResult]);
}

// =============================================================================
// Helpers
// =============================================================================

function normalizeInterval(
  value: string | null | undefined
): "month" | "year" | "week" | "day" | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "month" || v === "year" || v === "week" || v === "day") return v;
  return null;
}
