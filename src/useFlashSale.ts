import { useCallback, useEffect, useRef, useState } from "react";
import {
    ApiError,
    checkoutOrder,
    getFeaturedProduct,
    getReservation,
    openSession,
    releaseReservation,
    reserveStock,
} from "./api.ts";
import type { Order, Product, Session } from "./api.ts";

const HOLD_KEY = "flashkart.hold";
const SHOPPER_KEY = "flashkart.shopper";

function shopperClientId(): string {
    const existing = sessionStorage.getItem(SHOPPER_KEY);
    if (existing) {
        return existing;
    }
    const clientId = crypto.randomUUID();
    sessionStorage.setItem(SHOPPER_KEY, clientId);
    return clientId;
}

export type Hold = {
    reservationId: string;
    productId: string;
    quantity: number;
    expiresAt: string;
    idempotencyKey: string;
};

type Phase = "loading" | "ready" | "holding" | "confirmed" | "error";

function readHold(): Hold | null {
    const raw = sessionStorage.getItem(HOLD_KEY);
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw) as Hold;
    } catch {
        sessionStorage.removeItem(HOLD_KEY);
        return null;
    }
}

function writeHold(hold: Hold | null): void {
    if (!hold) {
        sessionStorage.removeItem(HOLD_KEY);
        return;
    }
    sessionStorage.setItem(HOLD_KEY, JSON.stringify(hold));
}

/**
 * The page keeps three clocks:
 * - product stock, polled from the API so other shoppers change the number
 * - the sale end, taken from saleEndsAt
 * - the 5-minute hold, taken from the server expiresAt and stored with its checkout key
 * A refresh restores the same hold and the same idempotency key, so checkout cannot create a second order.
 */
export function useFlashSale() {
    const [phase, setPhase] = useState<Phase>("loading");
    const [session, setSession] = useState<Session | null>(null);
    const [product, setProduct] = useState<Product | null>(null);
    const [hold, setHold] = useState<Hold | null>(null);
    const [order, setOrder] = useState<Order | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [pending, setPending] = useState<"reserve" | "checkout" | "release" | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const expiryStarted = useRef<string | null>(null);

    const refreshProduct = useCallback(async () => {
        const next = await getFeaturedProduct();
        setProduct(next);
        return next;
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function load(): Promise<void> {
            try {
                const [nextSession, nextProduct] = await Promise.all([
                    openSession(shopperClientId()),
                    getFeaturedProduct(),
                ]);
                if (cancelled) {
                    return;
                }
                setSession(nextSession);
                setProduct(nextProduct);

                const stored = readHold();
                if (stored && stored.productId === nextProduct.id && Date.parse(stored.expiresAt) > Date.now()) {
                    const live = await getReservation(nextSession.userId, stored.reservationId);
                    if (!cancelled && live.status === "HELD") {
                        const restored = { ...stored, expiresAt: live.expiresAt, quantity: live.quantity };
                        writeHold(restored);
                        setHold(restored);
                        setQuantity(live.quantity);
                        setPhase("holding");
                        return;
                    }
                }
                writeHold(null);
                if (!cancelled) {
                    setPhase("ready");
                }
            } catch (error) {
                if (!cancelled) {
                    setNotice(error instanceof Error ? error.message : "The sale could not be loaded");
                    setPhase("error");
                }
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!product || phase === "confirmed" || phase === "error") {
            return;
        }
        const timer = window.setInterval(() => {
            void refreshProduct().catch(() => undefined);
        }, 2000);
        return () => window.clearInterval(timer);
    }, [phase, product, refreshProduct]);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!hold || !session || phase !== "holding") {
            return;
        }
        if (Date.parse(hold.expiresAt) > now || expiryStarted.current === hold.reservationId) {
            return;
        }

        expiryStarted.current = hold.reservationId;
        const expired = hold;
        const userId = session.userId;
        writeHold(null);
        setHold(null);
        setPhase("ready");
        setNotice("The 5-minute hold expired. Those units are available again.");
        void releaseReservation(userId, expired.reservationId).catch(() => undefined);
        void refreshProduct().catch(() => undefined);
    }, [hold, now, phase, refreshProduct, session]);

    async function reserve(): Promise<void> {
        if (!session || !product || pending || product.saleEnded || product.stock < quantity) {
            return;
        }
        setPending("reserve");
        setNotice(null);
        try {
            const reservation = await reserveStock(session.userId, product.id, quantity);
            const previous = readHold();
            const nextHold: Hold = {
                reservationId: reservation.reservationId,
                productId: reservation.productId,
                quantity: reservation.quantity,
                expiresAt: reservation.expiresAt,
                idempotencyKey: previous?.reservationId === reservation.reservationId
                    ? previous.idempotencyKey
                    : crypto.randomUUID(),
            };
            writeHold(nextHold);
            setHold(nextHold);
            setPhase("holding");
            if (reservation.remainingStock != null) {
                setProduct({ ...product, stock: reservation.remainingStock });
            }
            setNotice(reservation.reused ? "You already have this hold. The timer did not reset." : null);
        } catch (error) {
            setNotice(error instanceof ApiError ? error.message : "Could not reserve stock");
            await refreshProduct().catch(() => undefined);
        } finally {
            setPending(null);
        }
    }

    async function checkout(): Promise<void> {
        if (!session || !hold || pending) {
            return;
        }
        setPending("checkout");
        setNotice(null);
        try {
            const nextOrder = await checkoutOrder(session.userId, hold.reservationId, hold.idempotencyKey);
            writeHold(null);
            setHold(null);
            setOrder(nextOrder);
            setPhase("confirmed");
        } catch (error) {
            const message = error instanceof ApiError ? error.message : "Checkout failed";
            const code = error instanceof ApiError ? error.code : "";
            if (code === "RESERVATION_EXPIRED" || code === "RESERVATION_CLOSED" || code === "RESERVATION_NOT_FOUND") {
                writeHold(null);
                setHold(null);
                setPhase("ready");
            }
            setNotice(message);
            await refreshProduct().catch(() => undefined);
        } finally {
            setPending(null);
        }
    }

    async function release(): Promise<void> {
        if (!session || !hold || pending) {
            return;
        }
        setPending("release");
        setNotice(null);
        try {
            await releaseReservation(session.userId, hold.reservationId);
            writeHold(null);
            setHold(null);
            setPhase("ready");
            setNotice("Hold released. The stock is available again.");
            await refreshProduct();
        } catch (error) {
            setNotice(error instanceof ApiError ? error.message : "Could not release the hold");
        } finally {
            setPending(null);
        }
    }

    const saleRemaining = product?.saleEndsAt ? Date.parse(product.saleEndsAt) - now : null;
    const holdRemaining = hold ? Date.parse(hold.expiresAt) - now : null;

    return {
        phase,
        session,
        product,
        hold,
        order,
        quantity,
        setQuantity,
        pending,
        notice,
        saleRemaining,
        holdRemaining,
        reserve,
        checkout,
        release,
    };
}
