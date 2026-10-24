const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type Session = {
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
};

export type Product = {
    id: string;
    name: string;
    description: string;
    price: number;
    stock: number;
    saleEndsAt: string | null;
    saleEnded: boolean;
};

export type Reservation = {
    reservationId: string;
    productId: string;
    quantity: number;
    status: string;
    expiresAt: string;
    remainingStock: number | null;
    reused: boolean;
};

export type Order = {
    orderId: string;
    total: number;
    idempotentReplay: boolean;
    items: Array<{ productName: string; quantity: number; unitPrice: number }>;
};

type ErrorBody = {
    error?: string;
    code?: string;
    details?: Record<string, unknown>;
};

export class ApiError extends Error {
    status: number;
    code: string;
    details?: Record<string, unknown>;

    constructor(message: string, status: number, code: string, details?: Record<string, unknown>) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

async function request<T>(path: string, init: RequestInit = {}, userId?: string): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) {
        headers.set("content-type", "application/json");
    }
    if (userId) {
        headers.set("x-user-id", userId);
    }

    const response = await fetch(`${API_URL}${path}`, { ...init, headers });
    const body = (await response.json().catch(() => ({}))) as T & ErrorBody;
    if (!response.ok) {
        throw new ApiError(body.error ?? "Request failed", response.status, body.code ?? "REQUEST_FAILED", body.details);
    }
    return body;
}

export function openSession(clientId: string): Promise<Session> {
    return request<Session>("/session", {
        method: "POST",
        body: JSON.stringify({ clientId }),
    });
}

export function getFeaturedProduct(): Promise<Product> {
    return request<Product>("/products/featured");
}

export function reserveStock(userId: string, productId: string, quantity: number): Promise<Reservation> {
    return request<Reservation>("/cart/reserve", {
        method: "POST",
        body: JSON.stringify({ productId, quantity }),
    }, userId);
}

export function getReservation(userId: string, reservationId: string): Promise<Reservation> {
    return request<Reservation>(`/reservations/${reservationId}`, {}, userId);
}

export function releaseReservation(userId: string, reservationId: string): Promise<Reservation> {
    return request<Reservation>(`/reservations/${reservationId}`, { method: "DELETE" }, userId);
}

export function checkoutOrder(userId: string, reservationId: string, idempotencyKey: string): Promise<Order> {
    return request<Order>("/order/checkout", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: JSON.stringify({ reservationId }),
    }, userId);
}
