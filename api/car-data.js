// api/car-data.js — Garage Knight's price service.
//
// This is the ONLY file that talks to Auto.dev. The app calls /api/car-data and
// gets back a simple { priceLow, priceHigh } in our own shape. If we ever switch
// data providers, we change ONLY this file — the app never knows the difference.
//
// Requires a Vercel environment variable named AUTODEV_API_KEY.

export default async function handler(req, res) {
  const make = String(req.query.make || "").trim();
  const model = String(req.query.model || "").trim();
  const year = String(req.query.year || "").trim(); // "2023" or a range like "2018-2024"

  if (!make || !model) {
    res.status(400).json({ error: "make and model are required" });
    return;
  }

  const key = process.env.AUTODEV_API_KEY;
  if (!key) {
    // No key configured yet — tell the app to fall back to its stored estimate.
    res.status(200).json({ priceLow: null, priceHigh: null, source: "no-key" });
    return;
  }

  const p = new URLSearchParams();
  p.set("vehicle.make", make);
  p.set("vehicle.model", model);
  if (year) p.set("vehicle.year", year);
  p.set("select", "retailListing.price"); // smallest possible payload
  p.set("sort", "price.asc");
  p.set("limit", "20"); // Starter plan caps at 20 — plenty for a price range

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
      .filter((v) => typeof v === "number" && v > 500)
      .sort((a, b) => a - b);

    if (prices.length === 0) {
      res.status(200).json({ priceLow: null, priceHigh: null, source: "no-listings" });
      return;
    }

    // Trim outliers: 15th–85th percentile so one oddly-priced listing can't skew it.
    const at = (frac) =>
      prices[Math.min(prices.length - 1, Math.max(0, Math.round(frac * (prices.length - 1))))];

    // Cache each car's price at Vercel's edge for ~24h — keeps us deep inside the free tier.
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({
      priceLow: at(0.15),
      priceHigh: at(0.85),
      count: prices.length,
      source: "auto.dev",
    });
  } catch (e) {
    // Any hiccup → app falls back to its stored estimate. Never breaks.
    res.status(200).json({ priceLow: null, priceHigh: null, source: "error" });
  }
}
