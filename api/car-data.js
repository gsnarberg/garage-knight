// api/car-data.js — Garage Knight's price service.
//
// This is the ONLY file that talks to Auto.dev. The app calls /api/car-data and
// gets back a simple { priceLow, priceHigh } in our own shape. If we ever switch
// data providers, we change ONLY this file — the app never knows the difference.
//
// Requires a Vercel environment variable named AUTODEV_API_KEY.

const MIN_PRICE = 2000;    // below this = deposits, parts cars, data errors — ignore
const MAX_PRICE = 300000;  // above this = typos / exotics — ignore
const MIN_SAMPLE = 4;      // need at least this many real listings per end to trust it

async function fetchPrices(key, make, model, year, direction) {
  const p = new URLSearchParams();
  p.set("vehicle.make", make);
  p.set("vehicle.model", model);
  if (year) p.set("vehicle.year", year);
  p.set("retailListing.price", `${MIN_PRICE}-${MAX_PRICE}`); // drop junk & typos at the source
  p.set("select", "retailListing.price");
  p.set("sort", `price.${direction}`); // asc = cheapest end, desc = priciest end
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
    .filter((v) => typeof v === "number" && v >= MIN_PRICE && v <= MAX_PRICE)
    .sort((a, b) => a - b);
}

const median = (arr) => arr[Math.floor(arr.length / 2)];

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

  try {
    // Sample BOTH ends of the market in parallel so the range reflects real spread,
    // not just whichever listings happen to be newest (which skews toward new cars).
    const [lows, highs] = await Promise.all([
      fetchPrices(key, make, model, year, "asc"),
      fetchPrices(key, make, model, year, "desc"),
    ]);

    if (lows.length < MIN_SAMPLE || highs.length < MIN_SAMPLE) {
      res.status(200).json({ priceLow: null, priceHigh: null, count: Math.max(lows.length, highs.length), source: "too-few" });
      return;
    }

    // Median of the cheapest listings = typical low/used price;
    // median of the priciest = typical high/new price. Medians shrug off oddballs.
    let priceLow = median(lows);
    let priceHigh = median(highs);
    if (priceLow > priceHigh) [priceLow, priceHigh] = [priceHigh, priceLow];

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({
      priceLow,
      priceHigh,
      count: lows.length + highs.length,
      source: "auto.dev",
    });
  } catch (e) {
    res.status(200).json({ priceLow: null, priceHigh: null, source: "error" });
  }
}
