import { useFlashSale } from "./useFlashSale.ts";

const rupees = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
});

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function clock(milliseconds: number): string {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
}

export default function App() {
    const sale = useFlashSale();
    const product = sale.product;
    const soldOut = Boolean(product && product.stock < 1 && sale.phase !== "holding");

    return (
        <main>
            <h1>FlashKart</h1>
            {sale.phase === "loading" && <p>Loading sale...</p>}
            {sale.phase === "error" && <p className="error">{sale.notice}</p>}

            {product && sale.phase !== "error" && (
                <section className="card">
                    <h2>{product.name}</h2>
                    <p>{product.description}</p>
                    <p>Price: {rupees.format(product.price)}</p>
                    <p>Remaining stock: {product.stock}</p>
                    {sale.saleRemaining != null && <p>Sale ends in: {clock(sale.saleRemaining)}</p>}

                    {sale.phase !== "holding" && sale.phase !== "confirmed" && (
                        <label>
                            Quantity{" "}
                            <input
                                type="number"
                                min={1}
                                max={5}
                                value={sale.quantity}
                                onChange={(event) => sale.setQuantity(clampQuantity(event.target.value))}
                            />
                        </label>
                    )}

                    {sale.phase === "holding" && sale.holdRemaining != null && (
                        <p>
                            Reserved: {clock(sale.holdRemaining)} ({sale.hold?.quantity} held)
                        </p>
                    )}

                    {sale.phase === "confirmed" && sale.order && (
                        <p>Order confirmed. Total {rupees.format(sale.order.total)}. Order {sale.order.orderId.slice(0, 8)}.</p>
                    )}

                    {sale.notice && <p className="error">{sale.notice}</p>}

                    <div className="actions">
                        {sale.phase !== "holding" && sale.phase !== "confirmed" && (
                            <button type="button" onClick={() => void sale.reserve()} disabled={sale.pending !== null || soldOut || product.saleEnded}>
                                {soldOut || product.saleEnded ? "Sale closed" : sale.pending === "reserve" ? "Holding..." : "Add to cart"}
                            </button>
                        )}
                        {sale.phase === "holding" && (
                            <>
                                <button type="button" onClick={() => void sale.checkout()} disabled={sale.pending !== null}>
                                    {sale.pending === "checkout" ? "Checking out..." : "Checkout"}
                                </button>
                                <button type="button" onClick={() => void sale.release()} disabled={sale.pending !== null}>
                                    Release
                                </button>
                            </>
                        )}
                        {sale.phase === "confirmed" && (
                            <button type="button" onClick={() => window.location.reload()}>
                                Back
                            </button>
                        )}
                    </div>
                    {sale.session && <p>Shopping as {sale.session.firstName} {sale.session.lastName}</p>}
                </section>
            )}
        </main>
    );
}

function clampQuantity(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        return 1;
    }
    return Math.min(5, Math.max(1, parsed));
}
