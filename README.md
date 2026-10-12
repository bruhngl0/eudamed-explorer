# EUDAMED Explorer

A Next.js app to search EU medical-device registrations by **EMDN / CND code**
through EUDAMED's public API, and inspect the full record for each device.

## Run

```bash
npm install
npm run dev     # http://localhost:3000
```

Default search is EMDN `W0105090601` (CORONAVIRUS / INFLUENZA – RT & POC).

## How it works

EUDAMED's API blocks direct browser calls (CORS), so the browser never calls it
directly. Two Next.js server routes proxy it:

- `GET /api/search` — proxies the device search, then **enriches** each row of
  the current page with fields that only exist in the per-device detail
  (device name, device model, criterion, AR country).
- `GET /api/device/[uuid]` — returns the full Basic-UDI (52 fields) and
  UDI-DI (61 fields) records for one device.

Core client lives in `src/lib/eudamed.ts`.

## Table columns

Trade name · Device name · Device model · Risk class id · Manufacturer ·
Manufacturer SRN · Device status id · Authorised rep · AR country · Criterion.

Click **View** on any row for every populated field in the raw records.

## Notes

- The upstream API returns intermittent `502`s; the client retries each call
  up to 4× with backoff.
- Pagination is 25 rows/page to keep each page's enrichment fast.
