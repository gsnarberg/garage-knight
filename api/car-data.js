// api/car-data.js — Garage Knight's price service.
//
// This is the ONLY file that talks to Auto.dev. The app calls /api/car-data and
// gets back a simple { priceLow, priceHigh } in our own shape. If we ever switch
// data providers, we change ONLY this file — the app never knows the difference.
//
// Requires a Vercel environment variable named AUTODEV_API_KEY.

const MIN_PRICE = 2000;    // below this = deposits, parts cars, data errors — ignore
const MAX_PRICE = 300000;  // above this = typos / exotics — ignore
const MIN_SAMPLE = 5;      // need at least this many real listings to trust a range

export default async function handler(req, res) {
  const make = String(req.query.make || "").trim();
  const model = String(req.query.model || "").trim();
  const year = String(req.query.year || "").trim(); // "2023" or a range like "2018-2025"

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  const key = process.env.AUTODEV_API_KEY;
  if (!key) {
    res.status(200).json({ priceLow: null, priceHigh: null, source: "no-key" });
    return;
  }

  const p = new URLSearchParams();
  p.set("vehicle.make", make);
  p.set("vehicle.model", model);
  if (year) p.set("vehicle.year", year);
  // Ask Auto.dev to only return real, sanely-priced listings — this alone removes
  // the deposit/parts-car junk that was dragging the floor down to a few hundred bucks.
  p.set("retailListing.price", `${MIN_PRICE}-${MAX_PRICE}`);
  p.set("select", "retailListing.price");
  p.set("limit", "20"); // Starter plan cap — a rough but real market sample
  // NOTE: intentionally NO price sort. Sorting cheapest-first would sample only the
  // low end; the default (most-recent) gives a natural cross-section of the market.

  try {
    const upstream = await fetch(`https://api.auto.dev/listings?${p.toString()}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!upstream.ok) throw new Error("upstream " + upstream.status);

    const json = await upstream.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    const prices = rows
      .map((row) =>
        typeof row["retailListing.price"] === "number"
          ? row["retailListing.price"]
          : row?.retailListing?.price
      )
      .filter((v) => typeof v === "number" && v >= MIN_PRICE && v <= MAX_PRICE)
      .sort((a, b) => a - b);

    // Too few real listings to be trustworthy — tell the app to keep its stored estimate.
    if (prices.length < MIN_SAMPLE) {
      res.status(200).json({ priceLow: null, priceHigh: null, count: prices.length, source: "too-few" });
      return;
    }

    // Use the TYPICAL middle band (20th–80th percentile) so a couple of oddballs at
    // either extreme can't distort the range people actually shop in.
    const at = (frac) =>
      prices[Math.min(prices.length - 1, Math.max(0, Math.round(frac * (prices.length - 1))))];

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({
      priceLow: at(0.2),
      priceHigh: at(0.8),
      count: prices.length,
      source: "auto.dev",
    });
  } catch (e) {
    res.status(200).json({ priceLow: null, priceHigh: null, source: "error" });
  }
}
