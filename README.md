# FlashKart web

React page for the FlashKart lightning deal. It talks to the API in the sibling `FlashKart` project.


```bash
npm install
npm run dev
```

The API must be running on `http://localhost:3000`. Override it with `VITE_API_URL`.

The hold and its checkout key live in `sessionStorage`. Reloading the page restores the same 5-minute timer and sends the same idempotency key, so a refresh cannot create a second order. When `expiresAt` passes, the page releases the reservation.
