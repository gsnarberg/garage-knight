// api/car-data.js — Garage Knight's price service.
//
// This is the ONLY file that talks to Auto.dev. The app calls /api/car-data and
// gets back a simple { priceLow, priceHigh } in our own shape. If we ever switch
// data providers, we change ONLY this file — the app never knows the difference.
//
// Requires a Vercel environment variable named AUTODEV_API_KEY.

const HARD_MIN = 2000;    // absolute sanity floor
const HARD_MAX = 400000;  // absolute sanity ceiling
const MIN_SAMPLE = 4;     // fewer real listings than this per end => don't trust it

async function fetchPrices(key, make, model, year, lo, hi, sort) {
  const p = new URLSearchParams();
  p.set("vehicle.make", make);
  p.set("vehicle.model", model);
  if (year) p.set("vehicle.year", year);
  p.set("retailListing.price", `${Math.round(lo)}-${Math.round(hi)}`);
  p.set("select", "retailListing.price");
  if (sort) p.set("sort", sort);
  p.set("limit", "20");

  const upstream = await fetch(`https://api.auto.dev/listings?${p.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!upstream.ok) throw new Error("upstream " + upstream.status);

  const json = await upstream.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map((row) =>
      typeof row["retailListing.price"] === "number"
        ? row["retailListing.price"]
        : row?.retailListing?.price
    )
    .filter((v) => typeof v === "number" && v >= lo && v <= hi)
    .sort((a, b) => a - b);
}

const median = (arr) => arr[Math.floor(arr.length / 2)];

export default async function handler(req, res) {
  const make = String(req.query.make || "").trim();
  const model = String(req.query.model || "").trim();
  const year = String(req.query.year || "").trim();

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  const key = process.env.AUTODEV_API_KEY;
  if (!key) {
    res.status(200).json({ priceLow: null, priceHigh: null, source: "no-key" });
    return;
  }

  try {
    // 1) Anchor: a quick natural sample tells us roughly what this car costs.
    const anchor = await fetchPrices(key, make, model, year, HARD_MIN, HARD_MAX, null);
    if (anchor.length < MIN_SAMPLE) {
      res.status(200).json({ priceLow: null, priceHigh: null, count: anchor.length, source: "too-few" });
      return;
    }
    const mid = median(anchor);

    // 2) Build a smart band around the car's own price level — this auto-rejects the
    //    salvage/parts junk at the bottom and the data-error typos at the top, and it
    //    adapts per car (a Rivian's band is nothing like a Civic's).
    const lo = Math.max(HARD_MIN, mid * 0.4);
    const hi = Math.min(HARD_MAX, mid * 2.5);

    // 3) Sample the clean low and high ends within that band.
    const [lows, highs] = await Promise.all([
      fetchPrices(key, make, model, year, lo, hi, "price.asc"),
      fetchPrices(key, make, model, year, lo, hi, "price.desc"),
    ]);

    if (lows.length < MIN_SAMPLE || highs.length < MIN_SAMPLE) {
      res.status(200).json({ priceLow: null, priceHigh: null, count: anchor.length, source: "too-few" });
      return;
    }

    let priceLow = median(lows);
    let priceHigh = median(highs);
    if (priceLow > priceHigh) [priceLow, priceHigh] = [priceHigh, priceLow];

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({ priceLow, priceHigh, count: lows.length + highs.length, source: "auto.dev" });
  } catch (e) {
    res.status(200).json({ priceLow: null, priceHigh: null, source: "error" });
  }
}
