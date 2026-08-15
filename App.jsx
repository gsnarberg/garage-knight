import React, { useState, useMemo, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────
//  THE ANTI-DEALERSHIP — Deal Decoder
//  Paste a dealer's numbers, see what you're really paying.
// ─────────────────────────────────────────────────────────────

const money = (n) => "$" + Math.round(n).toLocaleString();

// Pure logic (unit-testable): turn raw deal inputs into a verdict.
function analyzeDeal(inp) {
  const dealType = inp.dealType || "lease";
  const monthly = num(inp.monthly);
  const term = num(inp.termMonths);
  const cashDown = num(inp.cashDown);
  const tradeValue = num(inp.tradeValue);
  const tradeOwed = num(inp.tradeOwed);
  const maintPerMo = num(inp.maintPerMo);
  const otherFees = num(inp.otherFees);
  const milesPerYear = num(inp.milesPerYear);

  const tradeEquity = Math.max(0, tradeValue - tradeOwed);
  const downTotal = cashDown + tradeEquity;
  const totalPayments = monthly * term;
  const totalMaint = maintPerMo * term;
  const totalCost = downTotal + totalPayments + totalMaint + otherFees;
  const effectiveMonthly = term ? totalCost / term : totalCost;
  const ownsAtEnd = dealType !== "lease";

  const flags = [];
  if (dealType === "lease" && cashDown >= 1000)
    flags.push({ level: "red", title: "Cash down on a lease",
      body: `You put ${money(cashDown)} down on a car you hand back. A lease builds zero equity — this only lowers the payment, and it's gone entirely if the car is totaled.` });
  if (dealType === "lease" && tradeEquity >= 1000)
    flags.push({ level: "red", title: "You traded owned value into a lease",
      body: `Your trade carried about ${money(tradeEquity)} of equity. Rolled into a lease, that value disappears over ${term || 36} months with nothing to show for it.` });
  if (totalMaint >= 600)
    flags.push({ level: "gold", title: "Marked-up maintenance",
      body: `${money(maintPerMo)}/mo adds up to ${money(totalMaint)}. A low-mileage ${dealType === "lease" ? "lease" : "car"} usually needs only ~$300–500 of service over this term.` });
  if (otherFees >= 500)
    flags.push({ level: "gold", title: "Unexplained fees",
      body: `${money(otherFees)} in vague "other" charges. Ask for an itemized list — this is where junk add-ons hide (paint/fabric protection, VIN etching, nitrogen, doc padding).` });
  if (dealType === "finance" && term > 72)
    flags.push({ level: "gold", title: "Very long loan",
      body: `${term} months means you'll likely owe more than the car is worth for years. Shorter is safer.` });
  if (dealType === "lease" && milesPerYear > 0 && milesPerYear <= 10000)
    flags.push({ level: "gold", title: "Tight mileage cap",
      body: `${milesPerYear.toLocaleString()} miles/year is low. Go over and it's about $0.15–$0.30 per extra mile — make sure the cap fits how you actually drive.` });
  if (dealType !== "cash") {
    const gap = effectiveMonthly - (monthly + maintPerMo);
    if (gap > 50)
      flags.push({ level: "gold", title: "Your real payment is higher than it looks",
        body: `It feels like ${money(monthly + maintPerMo)}/mo — but counting everything you put in, the true cost is about ${money(effectiveMonthly)}/mo.` });
  }

  let verdict;
  if (flags.some((f) => f.level === "red")) verdict = { level: "red", label: "Walk back to the desk" };
  else if (flags.length) verdict = { level: "gold", label: "A few things to question" };
  else verdict = { level: "green", label: "This one looks fair" };

  return { dealType, term, downTotal, tradeEquity, totalPayments, totalMaint, otherFees,
    totalCost, effectiveMonthly, ownsAtEnd, monthly, maintPerMo, flags, verdict };
}
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// A rough "what a fair version looks like" benchmark. Deliberately conservative and
// clearly labeled as a ballpark — real numbers vary by state, credit, and the car.
function fairDeal(inp) {
  const dealType = inp.dealType || "lease";
  const price = num(inp.price);
  if (price <= 0) return null;
  const term = num(inp.termMonths) || 36;
  const down = num(inp.cashDown) + Math.max(0, num(inp.tradeValue) - num(inp.tradeOwed));
  const tax = price * 0.09;   // rough state tax + title
  const doc = 150;            // a reasonable doc fee (vs. junk padding)

  if (dealType === "cash") {
    const total = price + tax + doc;
    return { dealType, fairMonthly: 0, fairDown: total, fairTotal: total, term: 0 };
  }
  if (dealType === "lease") {
    const fairMonthly = price * 0.012;      // ~1.2% of MSRP rule of thumb, tax-inclusive
    return { dealType, fairMonthly, fairDown: 0, fairTotal: fairMonthly * term, term };
  }
  // finance
  const financed = Math.max(0, price + tax + doc - down);
  const rate = 0.07 / 12;                   // ~7% APR ballpark
  const fairMonthly = financed * rate / (1 - Math.pow(1 + rate, -term));
  return { dealType, fairMonthly, fairDown: down, fairTotal: down + fairMonthly * term, term };
}

const C = {
  bg: "#1b1915", panel: "rgba(255,255,255,0.03)", line: "rgba(255,255,255,0.08)",
  text: "#ede8dc", dim: "rgba(237,232,220,0.55)", faint: "rgba(237,232,220,0.35)",
  gold: "#cfaa5a", red: "#e0694f", green: "#82ad6a",
};
const tone = { red: C.red, gold: C.gold, green: C.green };

// Honest repair decision helper: is this repair even worth doing, given the car's value?
// (Exact "fair price for this job in your area" needs real repair-cost data — a later layer.)
function analyzeRepair(inp) {
  const cost = num(inp.repairCost);
  const value = num(inp.carValue);
  if (cost <= 0 || value <= 0) return null;
  const ratio = cost / value;
  let verdict;
  if (ratio >= 1)
    verdict = { level: "red", label: "The repair costs about what the car's worth",
      note: "When one fix approaches the car's whole value, it's usually time to seriously weigh replacing it rather than pouring money in." };
  else if (ratio >= 0.5)
    verdict = { level: "gold", label: "That's a big share of the car's value",
      note: "Worth doing only if the car is otherwise solid and you'll keep it a while. If problems are piling up, weigh replacing it." };
  else if (ratio >= 0.25)
    verdict = { level: "gold", label: "Meaningful — but often worth it",
      note: "If the car is otherwise reliable and you like it, a repair this size usually beats taking on a new car payment." };
  else
    verdict = { level: "green", label: "Usually worth fixing",
      note: "This is modest next to the car's value. Fixing a car you already like almost always beats a new monthly payment." };
  return { cost, value, ratio, verdict };
}

function RepairCheck({ onHome }) {
  const [what, setWhat] = useState("");
  const [repairCost, setRepairCost] = useState("");
  const [carValue, setCarValue] = useState("");
  const r = useMemo(() => analyzeRepair({ repairCost, carValue }), [repairCost, carValue]);

  const guidance = [
    "Get 2–3 quotes. An independent shop often beats the dealer by 20–40% on labor.",
    "Ask for it itemized — parts vs. labor, and whether parts are OEM or aftermarket.",
    "Ask \"what happens if I wait?\" Some repairs are safety-critical; others can hold a while.",
    "Be wary of \"while we're in there…\" add-ons you didn't come in for.",
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans', sans-serif",
      padding: "28px 18px 60px", maxWidth: 560, margin: "0 auto" }}>
      <style>{`* { box-sizing: border-box; } input:focus, textarea:focus { outline: none; border-color: rgba(207,170,90,0.5) !important; }`}</style>

      {onHome && (
        <button onClick={onHome} style={{ background: "none", border: "none", color: "rgba(207,170,90,0.75)",
          cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, fontWeight: 600, padding: "2px 0", marginBottom: 16 }}>‹ Home</button>
      )}
      <div style={{ letterSpacing: 3, fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 8 }}>THE ANTI-DEALERSHIP</div>
      <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 44, lineHeight: 1, margin: "0 0 10px" }}>Repair Check</h1>
      <p style={{ color: C.dim, fontSize: 15, lineHeight: 1.5, margin: "0 0 24px" }}>
        Got a repair quote? See whether it's even worth doing — and how to make sure you're not overpaying.
      </p>

      <label style={{ display: "block", marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: C.faint, marginBottom: 6 }}>What needs fixing? (optional)</div>
        <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. transmission, brakes, A/C compressor"
          style={{ width: "100%", padding: "11px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)",
            border: `1.5px solid ${C.line}`, color: C.text, fontSize: 15, fontFamily: "'DM Sans', sans-serif" }} />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 26 }}>
        <Field label="Repair quote" v={repairCost} set={setRepairCost}
          help={`The total the shop quoted for this repair. Ask for it in writing, itemized.`} />
        <Field label="What's your car worth?" v={carValue} set={setCarValue}
          help={`A rough resale value — a quick KBB or web search for your year, trim, and mileage gets you close.`} />
      </div>

      {r && (
        <div key={r.verdict.level} style={{ animation: "rise 0.4s ease",
          border: `1px solid ${tone[r.verdict.level]}`, background: `${tone[r.verdict.level]}14`,
          borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, fontWeight: 700, color: tone[r.verdict.level], marginBottom: 6 }}>SHOULD YOU DO IT?</div>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 28, lineHeight: 1.08, marginBottom: 10 }}>{r.verdict.label}</div>
          <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.55, marginBottom: 12 }}>{r.verdict.note}</div>
          <div style={{ fontSize: 13, color: C.faint }}>This repair is about <strong style={{ color: C.text }}>{Math.round(r.ratio * 100)}%</strong> of your car's value.</div>
        </div>
      )}

      <div style={{ border: `1px solid ${C.line}`, background: C.panel, borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, fontWeight: 700, color: C.gold, marginBottom: 12 }}>HOW TO NOT GET FLEECED</div>
        {guidance.map((g, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: i < guidance.length - 1 ? 10 : 0 }}>
            <span style={{ color: C.gold, fontSize: 15, lineHeight: 1.5 }}>›</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.55, color: C.dim }}>{g}</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.5, textAlign: "center" }}>
        We can't yet price-check this exact job for your area — that's coming. For now, these steps keep you protected. Not a substitute for a trusted mechanic.
      </div>
    </div>
  );
}

function DealDecoder({ onHome }) {
  const [dealType, setDealType] = useState("lease");
  // Prefilled with the real-world CR-V LS example.
  const [monthly, setMonthly] = useState("279");
  const [termMonths, setTermMonths] = useState("36");
  const [price, setPrice] = useState("32370");
  const [cashDown, setCashDown] = useState("0");
  const [tradeValue, setTradeValue] = useState("11000");
  const [tradeOwed, setTradeOwed] = useState("0");
  const [maintPerMo, setMaintPerMo] = useState("34");
  const [otherFees, setOtherFees] = useState("1000");
  const [milesPerYear, setMilesPerYear] = useState("12000");

  const r = useMemo(() => analyzeDeal({ dealType, monthly, termMonths, cashDown, tradeValue, tradeOwed, maintPerMo, otherFees, milesPerYear }),
    [dealType, monthly, termMonths, cashDown, tradeValue, tradeOwed, maintPerMo, otherFees, milesPerYear]);

  const fair = useMemo(() => fairDeal({ dealType, price, termMonths, cashDown, tradeValue, tradeOwed }),
    [dealType, price, termMonths, cashDown, tradeValue, tradeOwed]);
  const overBy = fair ? r.totalCost - fair.fairTotal : 0;

  const bars = [
    { label: "Down / trade", val: r.downTotal, color: C.red },
    { label: "Payments", val: r.totalPayments, color: C.gold },
    { label: "Add-ons & fees", val: r.totalMaint + r.otherFees, color: C.faint },
  ].filter((b) => b.val > 0);
  const maxBar = Math.max(...bars.map((b) => b.val), 1);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans', sans-serif",
      padding: "28px 18px 60px", maxWidth: 560, margin: "0 auto" }}>
      <style>{`
        * { box-sizing: border-box; }
        input { -webkit-appearance: none; }
        input:focus { outline: none; border-color: rgba(207,170,90,0.5) !important; }
        @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Header */}
      {onHome && (
        <button onClick={onHome} style={{ background: "none", border: "none", color: "rgba(207,170,90,0.75)",
          cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, fontWeight: 600,
          padding: "2px 0", marginBottom: 16 }}>‹ Home</button>
      )}
      <div style={{ letterSpacing: 3, fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 8 }}>THE ANTI-DEALERSHIP</div>
      <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 44, lineHeight: 1, margin: "0 0 10px" }}>Deal Decoder</h1>
      <p style={{ color: C.dim, fontSize: 15, lineHeight: 1.5, margin: "0 0 24px" }}>
        Type in the dealer's numbers. See what you're <em>really</em> paying — before you sign.
      </p>

      {/* Deal type */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["finance", "Finance"], ["lease", "Lease"], ["cash", "Cash"]].map(([v, label]) => (
          <button key={v} onClick={() => setDealType(v)} style={{
            flex: 1, padding: "11px 0", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif",
            background: dealType === v ? "rgba(207,170,90,0.16)" : "rgba(255,255,255,0.04)",
            border: dealType === v ? `1px solid ${C.gold}` : `1px solid ${C.line}`,
            color: dealType === v ? C.gold : C.dim }}>{label}</button>
        ))}
      </div>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 26 }}>
        <Field label="Sticker / sale price" v={price} set={setPrice}
          help={`The price of the car itself, before fees and interest. Ask the dealer: "What's the selling price of the vehicle?" — not the monthly payment.`} />
        {dealType !== "cash" && <Field label="Monthly payment" v={monthly} set={setMonthly}
          help={`What you'll pay every month. Ask: "What's the exact monthly payment, and what's bundled into it?"`} />}
        {dealType !== "cash" && <Field label="Term (months)" v={termMonths} set={setTermMonths} dollar={false}
          help={`How many months the loan or lease runs. 36 = 3 years, 60 = 5 years. Ask: "How long is the term?"`} />}
        {dealType === "lease" && <Field label="Miles per year" v={milesPerYear} set={setMilesPerYear} dollar={false}
          help={`Your yearly mileage limit on the lease — usually 10k, 12k, or 15k. Ask: "What's the annual mileage allowance, and the charge per mile if I go over?"`} />}
        {dealType !== "cash" && <Field label="Cash down" v={cashDown} set={setCashDown}
          help={`Money you pay up front out of pocket at signing — separate from your trade-in. Ask: "How much cash am I putting down at signing?"`} />}
        <Field label="Trade-in value" v={tradeValue} set={setTradeValue}
          help={`What the dealer is giving you for your current car. Ask: "What number are you giving me for my trade-in?"`} />
        <Field label="Still owed on trade" v={tradeOwed} set={setTradeOwed}
          help={`Any loan still left on the car you're trading in. Call your current lender and ask for the "payoff amount." Enter 0 if it's paid off.`} />
        {dealType !== "cash" && <Field label="Maintenance / mo" v={maintPerMo} set={setMaintPerMo}
          help={`Any service or maintenance plan added to your monthly bill. Ask: "Is a maintenance plan bundled in, and how much per month is it?"`} />}
        <Field label={'Other / "misc" fees'} v={otherFees} set={setOtherFees}
          help={`Extra add-ons and fees beyond the car — paint protection, VIN etching, doc fees, and the like. Ask: "Give me the full itemized, out-the-door breakdown of every fee."`} />
      </div>

      {/* Verdict */}
      <div key={r.verdict.level + r.flags.length} style={{ animation: "rise 0.4s ease",
        border: `1px solid ${tone[r.verdict.level]}`, background: `${tone[r.verdict.level]}14`,
        borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, fontWeight: 700, color: tone[r.verdict.level], marginBottom: 6 }}>
          VERDICT
        </div>
        <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 30, lineHeight: 1.05, marginBottom: 14 }}>
          {r.verdict.label}
        </div>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          <Stat label={dealType === "cash" ? "Total cost" : "TRUE cost / month"}
            value={dealType === "cash" ? money(r.totalCost) : money(r.effectiveMonthly)}
            sub={dealType !== "cash" ? `feels like ${money(r.monthly + r.maintPerMo)}/mo` : null} big />
          <Stat label="Total over term" value={money(r.totalCost)} />
          <Stat label="You own at the end" value={r.ownsAtEnd ? "The car" : "Nothing"}
            tone={r.ownsAtEnd ? C.green : C.red} />
        </div>
      </div>

      {/* Fair-deal target */}
      {fair && fair.fairTotal > 0 && (
        <div style={{ border: `1px solid rgba(207,170,90,0.35)`, background: "rgba(207,170,90,0.06)",
          borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, fontWeight: 700, color: C.gold, marginBottom: 10 }}>
            FAIR-DEAL TARGET <span style={{ color: C.faint, fontWeight: 600, letterSpacing: 0.5 }}>· ballpark</span>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.6, color: C.text, marginBottom: overBy > 500 || overBy < -500 ? 12 : 4 }}>
            {dealType === "cash"
              ? <>A fair all-in price lands around <strong style={{ color: C.gold }}>{money(fair.fairTotal)}</strong>.</>
              : <>A fair version looks like about <strong style={{ color: C.gold }}>{money(fair.fairMonthly)}/mo</strong>, <strong style={{ color: C.gold }}>{fair.fairDown > 0 ? money(fair.fairDown) + " down" : "$0 down"}</strong> — roughly <strong style={{ color: C.gold }}>{money(fair.fairTotal)}</strong> all in.</>}
          </div>
          {overBy > 500 && (
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.red }}>
              You're about {money(overBy)} over a fair deal — that's your room to negotiate.
            </div>
          )}
          {overBy < -500 && (
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.green }}>
              You're actually below the fair benchmark — nicely done.
            </div>
          )}
          {overBy >= -500 && overBy <= 500 && (
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.green }}>
              You're right around a fair deal — this checks out.
            </div>
          )}
          <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.5, marginTop: 10 }}>
            A rough estimate from typical tax, fees, and rates — real numbers shift with your state, credit, and the exact car. Aim for this; don't treat it as exact.
          </div>
        </div>
      )}

      {/* Where the money goes */}
      {bars.length > 0 && (
        <div style={{ border: `1px solid ${C.line}`, background: C.panel, borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, fontWeight: 700, color: C.faint, marginBottom: 14 }}>WHERE THE MONEY GOES</div>
          {bars.map((b) => (
            <div key={b.label} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                <span style={{ color: C.dim }}>{b.label}</span>
                <span style={{ color: C.text, fontWeight: 600 }}>{money(b.val)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 6, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(b.val / maxBar) * 100}%`, background: b.color, borderRadius: 6, transition: "width 0.4s ease" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Flags */}
      {r.flags.map((f, i) => (
        <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start",
          border: `1px solid ${tone[f.level]}44`, background: `${tone[f.level]}0d`,
          borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
          <div style={{ width: 9, height: 9, borderRadius: 9, background: tone[f.level], marginTop: 6, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: tone[f.level], marginBottom: 3 }}>{f.title}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: C.dim }}>{f.body}</div>
          </div>
        </div>
      ))}

      {r.flags.length === 0 && (
        <div style={{ fontSize: 14, color: C.dim, textAlign: "center", padding: "10px 0" }}>
          Nothing jumps out. Still ask for the out-the-door number in writing.
        </div>
      )}

      <div style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.5, marginTop: 20, textAlign: "center" }}>
        Estimates for guidance, not financial advice. Always get an itemized, out-the-door quote in writing.
      </div>
    </div>
  );
}

function Field({ label, v, set, help, dollar = true }) {
  const [open, setOpen] = useState(false);
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: C.faint, fontFamily: "'DM Sans', sans-serif" }}>{label}</span>
        {help && (
          <button type="button" onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
            aria-label={"What is " + label + "?"} style={{
              width: 16, height: 16, borderRadius: 16, flexShrink: 0, cursor: "pointer", lineHeight: 1,
              fontSize: 11, fontWeight: 700, fontFamily: "'DM Sans', sans-serif", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: open ? "rgba(207,170,90,0.2)" : "transparent",
              border: `1px solid ${C.gold}`, color: C.gold }}>?</button>
        )}
      </div>
      {open && help && (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: C.dim, background: "rgba(207,170,90,0.07)",
          border: "1px solid rgba(207,170,90,0.25)", borderRadius: 10, padding: "9px 11px", marginBottom: 8 }}>
          {help}
        </div>
      )}
      <div style={{ position: "relative" }}>
        {dollar && <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.faint, fontSize: 14 }}>$</span>}
        <input type="number" inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} style={{
          width: "100%", padding: dollar ? "11px 12px 11px 24px" : "11px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)",
          border: `1.5px solid ${C.line}`, color: C.text, fontSize: 15, fontFamily: "'DM Sans', sans-serif" }} />
      </div>
    </label>
  );
}

function Stat({ label, value, sub, big, tone: t }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: big ? 32 : 22, lineHeight: 1, color: t || C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ─── STEP DEFINITIONS ───
const STEPS = [
  { id: "welcome", phase: "intro" },
  { id: "carHistory", phase: "history" },
  { id: "powertrain", phase: "power" },
  { id: "vibe", phase: "taste" },
  { id: "drive", phase: "visceral" },
  { id: "cabin", phase: "visceral" },
  { id: "hidden", phase: "hidden" },
  { id: "lifeFit", phase: "practical" },
  { id: "dealbreakers", phase: "practical" },
  { id: "financial", phase: "financial" },
  { id: "ownership", phase: "financial" },
  { id: "loading", phase: "results" },
  { id: "results", phase: "results" },
];

const PHASE_LABELS = {
  history: "Your Car Story",
  power: "Power Type",
  taste: "Visual Taste",
  visceral: "The Feel",
  hidden: "The Stuff People Miss",
  practical: "Life Fit",
  financial: "Smart Money",
  results: "Your Matches",
};

// ─── CAR DATABASE ───
// priceLow/priceHigh = realistic real-world price range (used market where applicable)
// drive: connected | balanced | smooth | commanding
// aesthetic: sculpted, minimal, aggressive, retro, rugged, elegant
// cabin: quiet, premium, sound, seats, visibility, simple, tech, smell
// reliability/techComplexity/depreciation/efficiency/uniqueness: high|mid|low
const CAR_DB = [
  { name: "Mazda MX-5 Miata", years: "2016–2024", avail: "both", priceLow: 18000, priceHigh: 34000,
    body: "convertible", drive: "connected", aesthetic: ["sculpted","minimal"], cabin: ["seats","simple","visibility"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "high", uniqueness: "high", seats: 2, luxury: false,
    visceral: "It feels like an extension of your body — light, eager, and endlessly playful on a back road.",
    watchOut: "Tight on space and not built for hauling people or stuff.",
    proTip: "Look for a Club trim with the limited-slip diff for the best driving feel." },
  { name: "Toyota GR86", years: "2022–2025", avail: "both", priceLow: 28000, priceHigh: 35000,
    body: "coupe", drive: "connected", aesthetic: ["aggressive","sculpted"], cabin: ["seats","simple"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "high", uniqueness: "mid", seats: 4, luxury: false,
    visceral: "Analog, rear-drive joy — communicative steering and a chuckable chassis that rewards skill over horsepower.",
    watchOut: "Back seats are essentially cargo shelves; the engine note is more buzzy than musical.",
    proTip: "The 2022+ second-gen fixed the old mid-range torque dip — the one to seek out." },
  { name: "Subaru BRZ", years: "2022–2025", avail: "both", priceLow: 28000, priceHigh: 36000,
    body: "coupe", drive: "connected", aesthetic: ["aggressive","sculpted"], cabin: ["seats","simple"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "high", uniqueness: "mid", seats: 4, luxury: false,
    visceral: "The GR86's twin under the skin — light, balanced, rear-drive, and endlessly tossable on a back road.",
    watchOut: "Tiny rear seats, modest cabin materials, and a thrummy flat-four soundtrack.",
    proTip: "Cross-shop it against the GR86 on price and color — mechanically they're near-identical." },
  { name: "Porsche 718 Cayman", years: "2017–2024", avail: "both", priceLow: 48000, priceHigh: 90000,
    body: "coupe", drive: "connected", aesthetic: ["sculpted","elegant"], cabin: ["premium","seats","quiet"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "high", seats: 2, luxury: true,
    visceral: "Mid-engine balance so pure it makes most supercars feel clumsy — every input is crisp and trustworthy.",
    watchOut: "The four-cylinder turbo models sound less special than the older flat-sixes.",
    proTip: "A used GTS 4.0 with the flat-six is the sweet spot if budget allows." },
  { name: "BMW M2", years: "2016–2021", avail: "used", priceLow: 38000, priceHigh: 58000,
    body: "coupe", drive: "connected", aesthetic: ["aggressive","muscular"], cabin: ["premium","seats","sound"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "high", seats: 4, luxury: true,
    visceral: "A compact muscle coupe with real bite — eager turbo punch and a tail that wants to play.",
    watchOut: "Maintenance and tires aren't cheap; some early cars need careful inspection.",
    proTip: "The M2 Competition (2019+) upgraded to the better S55 engine — prioritize it." },
  { name: "BMW 3 Series (330i/M340i)", years: "2019–2024", avail: "both", priceLow: 30000, priceHigh: 58000,
    body: "sedan", drive: "balanced", aesthetic: ["aggressive","elegant"], cabin: ["premium","sound","quiet","tech"],
    reliability: "mid", techComplexity: "high", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: true,
    visceral: "The benchmark sport sedan — composed and quiet on the commute, genuinely fun when the road opens up.",
    watchOut: "The latest iDrive is feature-packed but can feel busy if you prefer simple controls.",
    proTip: "A lightly used M340i gives near-M performance for far less money." },
  { name: "Audi S5 Sportback", years: "2018–2023", avail: "used", priceLow: 38000, priceHigh: 60000,
    body: "sedan", drive: "balanced", aesthetic: ["sculpted","elegant"], cabin: ["premium","quiet","tech","smell"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: true,
    visceral: "All-weather confidence with a gorgeous fastback shape and a cabin that feels genuinely special.",
    watchOut: "Depreciation is steep — great for used buyers, painful if bought new.",
    proTip: "Buy used at 2–3 years old; someone else absorbed the big depreciation hit." },
  { name: "Genesis G70", years: "2019–2024", avail: "both", priceLow: 28000, priceHigh: 50000,
    body: "sedan", drive: "balanced", aesthetic: ["elegant","sculpted"], cabin: ["premium","quiet","seats"],
    reliability: "high", techComplexity: "mid", depreciation: "high", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: true,
    visceral: "A genuine BMW rival that nobody expected — plush, well-built, and quietly confident.",
    watchOut: "Resale isn't strong yet, which is bad for new buyers but a gift for used shoppers.",
    proTip: "The 3.3T V6 is a steal used; the long warranty often transfers to second owners." },
  { name: "Lexus IS 350", years: "2014–2024", avail: "both", priceLow: 22000, priceHigh: 48000,
    body: "sedan", drive: "balanced", aesthetic: ["aggressive","elegant"], cabin: ["premium","quiet","seats","sound"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: true,
    visceral: "Bulletproof reliability wrapped in a sharp suit — the naturally aspirated V6 is smooth and willing.",
    watchOut: "Not the sportiest in its class; infotainment in older models feels dated.",
    proTip: "Famously reliable — a higher-mileage one is often a safer bet than a rival with half the miles." },
  { name: "Lexus ES 350", years: "2013–2024", avail: "both", priceLow: 18000, priceHigh: 45000,
    body: "sedan", drive: "smooth", aesthetic: ["elegant","minimal"], cabin: ["quiet","premium","seats","smell"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "mid", uniqueness: "low", seats: 5, luxury: true,
    visceral: "Whisper-quiet and serenely smooth — you step out after a long drive feeling completely unruffled.",
    watchOut: "Front-wheel-drive and comfort-tuned; not for anyone craving sharp handling.",
    proTip: "One of the most reliable luxury cars ever — used examples are extraordinary value." },
  { name: "Mercedes-Benz E-Class", years: "2017–2023", avail: "both", priceLow: 30000, priceHigh: 65000,
    body: "sedan", drive: "smooth", aesthetic: ["elegant","minimal"], cabin: ["quiet","premium","sound","smell","tech"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: true,
    visceral: "The executive-class gold standard — hushed, cosseting, and effortlessly composed at any speed.",
    watchOut: "Out-of-warranty repairs can be expensive; lots of complex tech to maintain.",
    proTip: "Buy certified pre-owned with remaining warranty to tame the repair-cost risk." },
  { name: "Toyota Camry", years: "2018–2024", avail: "both", priceLow: 16000, priceHigh: 35000,
    body: "sedan", drive: "smooth", aesthetic: ["minimal","sculpted"], cabin: ["quiet","seats","simple"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "high", uniqueness: "low", seats: 5, luxury: false,
    visceral: "Quietly excellent at everything — the car that just works, year after year, without drama.",
    watchOut: "Sensible rather than exciting; it won't stir your soul on a back road.",
    proTip: "The hybrid version sips fuel and is just as reliable — worth the small premium." },
  { name: "Honda Accord", years: "2018–2024", avail: "both", priceLow: 17000, priceHigh: 36000,
    body: "sedan", drive: "balanced", aesthetic: ["minimal","sculpted"], cabin: ["seats","simple","quiet"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "high", uniqueness: "low", seats: 5, luxury: false,
    visceral: "Secretly fun to drive for a family sedan — crisp handling and a punchy turbo make errands enjoyable.",
    watchOut: "Understated styling; not a head-turner if presence matters to you.",
    proTip: "The 2.0T trims are genuinely quick — a hidden enthusiast bargain on the used market." },
  { name: "Honda Civic", years: "2016–2025", avail: "both", priceLow: 15000, priceHigh: 45000,
    body: "sedan", drive: "balanced", aesthetic: ["sculpted","aggressive"], cabin: ["seats","simple","tech"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "Right-sized and genuinely engaging — and in Si or Type R form, an everyday car that turns giant-killer.",
    watchOut: "Base trims are sensible but plain; the hot versions can carry dealer markups.",
    proTip: "A used Si is the enthusiast value play — most of the fun for far less than a Type R." },
  { name: "Mazda CX-5", years: "2017–2024", avail: "both", priceLow: 17000, priceHigh: 38000,
    body: "suv", drive: "balanced", aesthetic: ["sculpted","elegant"], cabin: ["premium","quiet","seats"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "Drives like something far more expensive — composed, quiet, and quietly premium inside.",
    watchOut: "Cargo space trails some rivals; rear seat is cozy for taller passengers.",
    proTip: "The Signature trim's interior shames cars costing twice as much." },
  { name: "Subaru Outback", years: "2015–2024", avail: "both", priceLow: 16000, priceHigh: 40000,
    body: "wagon", drive: "commanding", aesthetic: ["rugged","minimal"], cabin: ["visibility","seats","simple"],
    reliability: "high", techComplexity: "mid", depreciation: "low", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "Go-anywhere confidence without the bulk of an SUV — tall, planted, and endlessly practical.",
    watchOut: "Base engine is adequate, not quick; some years had infotainment quirks.",
    proTip: "Look for the turbocharged XT trims if you want actual passing power." },
  { name: "Kia Telluride", years: "2020–2024", avail: "both", priceLow: 28000, priceHigh: 50000,
    body: "suv", drive: "smooth", aesthetic: ["rugged","elegant"], cabin: ["premium","quiet","seats","visibility"],
    reliability: "high", techComplexity: "mid", depreciation: "low", efficiency: "mid", uniqueness: "mid", seats: 8, luxury: false,
    visceral: "Big, plush, and genuinely upscale-feeling — it makes three rows of seats feel like a treat, not a compromise.",
    watchOut: "Demand is high, so used prices stay stubbornly strong.",
    proTip: "The SX trim rivals luxury badges inside for thousands less." },
  { name: "Toyota 4Runner", years: "2010–2024", avail: "both", priceLow: 20000, priceHigh: 52000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","retro"], cabin: ["visibility","simple","seats"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "low", uniqueness: "high", seats: 5, luxury: false,
    visceral: "Old-school, body-on-frame toughness — it feels like it could outlive you and asks for almost nothing in return.",
    watchOut: "Thirsty, dated to drive on-road, and the ride is trucky.",
    proTip: "Holds value better than almost anything — a high-mile one is still a safe buy." },
  { name: "Ford Bronco", years: "2021–2024", avail: "both", priceLow: 32000, priceHigh: 60000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","retro"], cabin: ["visibility","simple"],
    reliability: "mid", techComplexity: "mid", depreciation: "low", efficiency: "low", uniqueness: "high", seats: 5, luxury: false,
    visceral: "Retro adventure swagger with real off-road hardware — removable doors and roof make every drive feel like an event.",
    watchOut: "Early build-quality hiccups; on-road refinement is secondary to capability.",
    proTip: "The Sasquatch package gets you the serious off-road gear in one box." },
  { name: "Jeep Wrangler", years: "2012–2024", avail: "both", priceLow: 18000, priceHigh: 55000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","retro"], cabin: ["visibility","simple"],
    reliability: "mid", techComplexity: "low", depreciation: "low", efficiency: "low", uniqueness: "high", seats: 5, luxury: false,
    visceral: "Pure open-air freedom — doors off, top down, it's less a car than a lifestyle statement.",
    watchOut: "Wandery on the highway, loud, and not the most reliable; buy for character, not comfort.",
    proTip: "Incredible resale value means buying used barely costs more than the depreciation you'll avoid." },
  { name: "Tesla Model 3", years: "2018–2024", avail: "both", priceLow: 22000, priceHigh: 45000,
    body: "sedan", drive: "connected", aesthetic: ["minimal","sculpted"], cabin: ["tech","quiet","minimal"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "Instant, silent thrust and a minimalist cabin — it feels like driving a gadget from the future.",
    watchOut: "Everything lives in the touchscreen, which frustrates anyone who likes physical buttons; build quality varies.",
    proTip: "Used prices have dropped sharply — a 2–3 year old one is a strong value now." },
  { name: "BMW iX", years: "2022–2025", avail: "both", priceLow: 55000, priceHigh: 90000,
    body: "suv", drive: "smooth", aesthetic: ["sculpted","minimal"], cabin: ["tech","quiet","premium","sound"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "mid", seats: 5, luxury: true, power: ["ev"],
    visceral: "A serene electric luxury SUV — hushed, beautifully finished, and effortlessly quick when you ask.",
    watchOut: "Polarizing styling and heavy screen reliance; depreciation is steep.",
    proTip: "Steep EV depreciation makes a used iX a lot of luxury for the money — let the first owner take the hit." },
  { name: "BMW i4", years: "2022–2025", avail: "both", priceLow: 38000, priceHigh: 70000,
    body: "sedan", drive: "connected", aesthetic: ["sculpted","aggressive"], cabin: ["tech","quiet","premium","sound"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "mid", seats: 5, luxury: true, power: ["ev"],
    visceral: "An electric 4-Series — genuinely fun to drive, and the M50 version is savagely quick.",
    watchOut: "Range dips in the cold and options pile up fast; used depreciation is real.",
    proTip: "The M50 is the driver's pick; a used one is a performance bargain thanks to EV depreciation." },
  { name: "Porsche Macan", years: "2017–2024", avail: "both", priceLow: 32000, priceHigh: 70000,
    body: "suv", drive: "balanced", aesthetic: ["sculpted","elegant"], cabin: ["premium","quiet","seats","smell"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "high", seats: 5, luxury: true,
    visceral: "A sports car hiding in an SUV body — it actually wants to be driven hard, and the cabin feels jewel-like.",
    watchOut: "Maintenance is Porsche-priced; rear space is tight for the class.",
    proTip: "A used base Macan with the S suspension drives beautifully for the money." },
  { name: "Volvo XC90", years: "2016–2024", avail: "both", priceLow: 22000, priceHigh: 65000,
    body: "suv", drive: "smooth", aesthetic: ["minimal","elegant"], cabin: ["quiet","premium","seats","smell","visibility"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "mid", uniqueness: "mid", seats: 7, luxury: true,
    visceral: "Scandinavian calm made physical — airy, beautifully restrained, and deeply relaxing on a long haul.",
    watchOut: "Tech-heavy with a screen-centric interface; some reliability quibbles out of warranty.",
    proTip: "Used examples are a luxury-SUV steal thanks to heavy depreciation." },
  { name: "Lexus RX 350", years: "2016–2024", avail: "both", priceLow: 22000, priceHigh: 55000,
    body: "suv", drive: "smooth", aesthetic: ["elegant","sculpted"], cabin: ["quiet","premium","seats","smell"],
    reliability: "high", techComplexity: "mid", depreciation: "low", efficiency: "mid", uniqueness: "low", seats: 5, luxury: true,
    visceral: "Quiet, plush, and utterly dependable — the luxury SUV that just never lets you down.",
    watchOut: "Soft and comfort-focused; not engaging to drive.",
    proTip: "Among the most reliable luxury SUVs made — used ones age gracefully." },
  { name: "Acura Integra", years: "2023–2025", avail: "both", priceLow: 28000, priceHigh: 52000,
    body: "sedan", drive: "balanced", aesthetic: ["sculpted","aggressive"], cabin: ["premium","sound","seats"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: true,
    visceral: "A premium Civic Si in a sharp suit — and the Type S, with its manual and 320 hp, is a genuine driver's car.",
    watchOut: "Pricey next to the Civic it shares bones with; touchpad-era trims are fiddly.",
    proTip: "The Type S with the 6-speed manual is the enthusiast's pick of the lineup." },
  { name: "Acura TLX", years: "2021–2025", avail: "both", priceLow: 30000, priceHigh: 57000,
    body: "sedan", drive: "balanced", aesthetic: ["aggressive","sculpted"], cabin: ["premium","sound","quiet","seats"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: true,
    visceral: "A sharp-suited sport sedan with a killer ELS sound system — and the Type S adds real V6 turbo bite.",
    watchOut: "Touchpad infotainment takes practice; the back seat is a touch snug.",
    proTip: "The Type S delivers near-premium performance with Honda-grade dependability underneath." },
  { name: "Chevrolet Corvette (C7)", years: "2014–2019", avail: "used", priceLow: 38000, priceHigh: 65000,
    body: "coupe", drive: "connected", aesthetic: ["aggressive","sculpted"], cabin: ["sound","seats"],
    reliability: "mid", techComplexity: "mid", depreciation: "low", efficiency: "mid", uniqueness: "high", seats: 2, luxury: false,
    visceral: "Supercar pace and drama for sports-car money — the V8 snarl and shove never get old.",
    watchOut: "Interior plastics lag the price tag; it's wide and low for daily errands.",
    proTip: "C7 Stingrays have stabilized in value — a clean used one is a lot of car per dollar." },
  { name: "Mercedes-Benz S-Class", years: "2017–2022", avail: "used", priceLow: 45000, priceHigh: 95000,
    body: "sedan", drive: "smooth", aesthetic: ["elegant","minimal"], cabin: ["quiet","premium","sound","smell","tech"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: true,
    visceral: "The benchmark for automotive serenity — it isolates you from the world in a way nothing else quite matches.",
    watchOut: "Out-of-warranty repairs can be eye-watering; depreciation is brutal when new.",
    proTip: "A used S-Class is the most luxury-per-dollar on earth — just budget for an extended warranty." },
  { name: "Genesis GV80", years: "2021–2024", avail: "both", priceLow: 38000, priceHigh: 65000,
    body: "suv", drive: "smooth", aesthetic: ["elegant","sculpted"], cabin: ["quiet","premium","seats","smell","sound"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 7, luxury: true,
    visceral: "Outrageously plush and beautifully designed — it silences anyone who doubts the badge.",
    watchOut: "Brand is still proving long-term resale; dealer network is thinner.",
    proTip: "Cross-shop against the German trio — the GV80 often wins on value and warranty." },
  { name: "Lexus LC 500", years: "2018–2024", avail: "both", priceLow: 55000, priceHigh: 90000,
    body: "coupe", drive: "balanced", aesthetic: ["sculpted","elegant"], cabin: ["premium","quiet","seats","smell","sound"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "high", seats: 4, luxury: true,
    visceral: "Rolling sculpture with a naturally aspirated V8 that sounds glorious — a grand tourer for the soul.",
    watchOut: "More cruiser than corner-carver; rear seats are token.",
    proTip: "The V8 (not the hybrid) is the one to have for that intoxicating soundtrack." },
  { name: "Toyota Land Cruiser", years: "2024–2025", avail: "new", priceLow: 57000, priceHigh: 63000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","elegant"], cabin: ["quiet","visibility","seats"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "mid", uniqueness: "high", seats: 5, luxury: false,
    visceral: "The icon, reborn — a hybrid-powered, go-anywhere machine that feels built to outlast you, with retro-tough looks to match.",
    watchOut: "Only five seats, a firm old-school ride, and dealers often mark them up over MSRP.",
    proTip: "The standard hybrid four-cylinder is torquey and far thriftier than the old V8 — the modern Land Cruiser's quiet party trick." },
  { name: "Lexus GX", years: "2024–2025", avail: "new", priceLow: 65000, priceHigh: 81000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","elegant"], cabin: ["premium","quiet","seats","visibility"],
    reliability: "high", techComplexity: "mid", depreciation: "low", efficiency: "low", uniqueness: "high", seats: 7, luxury: true,
    visceral: "Body-on-frame toughness wrapped in genuine Lexus luxury — it'll crawl a trail and coddle you the whole way.",
    watchOut: "The twin-turbo V6 is a real gas-guzzler, and the third row is tight.",
    proTip: "Shares its rugged bones with the Land Cruiser but adds plush materials and a third row — the luxury pick of the two." },
  { name: "Volkswagen GTI", years: "2015–2025", avail: "both", priceLow: 16000, priceHigh: 38000,
    body: "hatchback", drive: "connected", aesthetic: ["minimal","sculpted"], cabin: ["seats","premium","simple"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "The do-everything enthusiast hatch — fun, quick, and practical enough to be your only car.",
    watchOut: "Newer models moved to fussy touch controls; budget for some turbo upkeep.",
    proTip: "A used MK7 GTI (2015–2021) with real buttons is the sweet spot." },
  { name: "Volkswagen Golf R", years: "2015–2025", avail: "both", priceLow: 26000, priceHigh: 50000,
    body: "hatchback", drive: "connected", aesthetic: ["minimal","aggressive"], cabin: ["seats","premium","simple"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "The GTI's all-wheel-drive big brother — savagely quick in any weather, yet still hatchback-practical.",
    watchOut: "Commands a big premium over the GTI; touch controls and turbo upkeep apply.",
    proTip: "If you see rain or snow, the R's AWD grip is worth the step up over the GTI." },
  { name: "Hyundai Tucson", years: "2022–2025", avail: "both", priceLow: 16000, priceHigh: 38000,
    body: "suv", drive: "smooth", aesthetic: ["sculpted","aggressive"], cabin: ["seats","quiet","visibility","tech"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "Boldly styled and loaded with tech for the money — a compact SUV that feels a class above its price.",
    watchOut: "Some engine families had recalls — check service history; touch controls take adjustment.",
    proTip: "The hybrid is efficient and often still carries a strong remaining warranty used." },
  { name: "Hyundai Santa Fe", years: "2019–2025", avail: "both", priceLow: 18000, priceHigh: 46000,
    body: "suv", drive: "smooth", aesthetic: ["rugged","sculpted"], cabin: ["seats","quiet","visibility","premium"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "high", uniqueness: "mid", seats: 7, luxury: false,
    visceral: "A roomy, boxy family hauler — the latest one seats up to seven and feels genuinely upscale inside.",
    watchOut: "Check engine service history on older ones; the third row is best for kids.",
    proTip: "The hybrid Santa Fe pairs three rows with real efficiency — a rare, sensible combo." },
  { name: "Ford Mustang GT", years: "2015–2024", avail: "both", priceLow: 22000, priceHigh: 50000,
    body: "coupe", drive: "connected", aesthetic: ["aggressive","retro"], cabin: ["sound","seats"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "mid", seats: 4, luxury: false,
    visceral: "Big V8 muscle and a soundtrack to match — raw, charismatic, and endlessly grin-inducing.",
    watchOut: "Thirsty, and the back seat is mostly decorative.",
    proTip: "A used GT with the Performance Pack is the value-packed enthusiast choice." },
  { name: "Honda CR-V", years: "2018–2025", avail: "both", priceLow: 18000, priceHigh: 40000,
    body: "suv", drive: "smooth", aesthetic: ["minimal","sculpted"], cabin: ["seats","visibility","simple","quiet"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "high", uniqueness: "low", seats: 5, luxury: false,
    visceral: "The sensible-shoe SUV that quietly nails it — roomy, refined, frugal, and nearly impossible to wear out.",
    watchOut: "Pleasant but unexciting to drive; you buy it with your head.",
    proTip: "The hybrid adds efficiency and resale strength for a small premium — the pick of the range." },
  { name: "Toyota RAV4", years: "2019–2025", avail: "both", priceLow: 18000, priceHigh: 42000,
    body: "suv", drive: "smooth", aesthetic: ["rugged","sculpted"], cabin: ["seats","visibility","simple"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "high", uniqueness: "low", seats: 5, luxury: false,
    visceral: "The best-selling SUV in America for good reason — tough-looking, dependable, and thrifty, especially as a hybrid.",
    watchOut: "The base engine is coarse and the ride firm; it's practical, not plush.",
    proTip: "The RAV4 Hybrid is the sweet spot — great mpg and legendary resale; the Prime plug-in goes further still." },
  // ─── Electric ───
  { name: "Hyundai Ioniq 5", years: "2022–2025", avail: "both", priceLow: 25000, priceHigh: 50000,
    body: "suv", drive: "smooth", aesthetic: ["minimal","sculpted"], cabin: ["tech","quiet","seats","visibility"],
    reliability: "high", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "high", seats: 5, luxury: false, power: ["ev"],
    visceral: "Retro-futuristic and spaceship-smooth — ultra-fast charging, a lounge-like flat-floor cabin, and real character.",
    watchOut: "Best if you can charge at home; steep depreciation (which is great news buying used).",
    proTip: "Used Ioniq 5s have dropped hard — a nearly-new one is one of the best EV bargains going." },
  { name: "Kia EV6", years: "2022–2025", avail: "both", priceLow: 26000, priceHigh: 55000,
    body: "suv", drive: "connected", aesthetic: ["sculpted","aggressive"], cabin: ["tech","quiet","seats"],
    reliability: "high", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "high", seats: 5, luxury: false, power: ["ev"],
    visceral: "The Ioniq 5's sportier cousin — sharper styling, the same rapid charging, and a genuinely quick GT version.",
    watchOut: "Same home-charging caveat and steep depreciation as its Hyundai sibling.",
    proTip: "Cross-shop it with the Ioniq 5 — the EV6 leans sportier, the Ioniq 5 roomier; both are used bargains." },
  { name: "Tesla Model Y", years: "2021–2024", avail: "both", priceLow: 30000, priceHigh: 52000,
    body: "suv", drive: "connected", aesthetic: ["minimal","sculpted"], cabin: ["tech","quiet","minimal"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false, power: ["ev"],
    visceral: "Quick, practical, and backed by the best charging network — the default EV for good reason.",
    watchOut: "Everything lives in the touchscreen, and build quality can vary unit to unit.",
    proTip: "Used prices have fallen a lot — a 2–3 year old one is strong value right now." },
  { name: "Ford Mustang Mach-E", years: "2021–2024", avail: "both", priceLow: 26000, priceHigh: 50000,
    body: "suv", drive: "connected", aesthetic: ["aggressive","sculpted"], cabin: ["tech","sound","quiet"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false, power: ["ev"],
    visceral: "Genuinely fun to drive for an electric SUV — punchy, eager, and surprisingly engaging.",
    watchOut: "Real-world range drops noticeably in cold weather.",
    proTip: "Heavy depreciation makes a used Mach-E one of the best EV bargains around." },
  { name: "Polestar 2", years: "2021–2024", avail: "both", priceLow: 24000, priceHigh: 48000,
    body: "sedan", drive: "balanced", aesthetic: ["minimal","elegant"], cabin: ["minimal","premium","tech","sound"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "high", seats: 5, luxury: true, power: ["ev"],
    visceral: "Scandinavian-cool and beautifully built, with a clean, Google-powered interface.",
    watchOut: "Range is modest versus the newest rivals; the back seat is snug.",
    proTip: "Used Polestars are a quiet luxury-EV steal thanks to steep depreciation." },
  { name: "Rivian R1S", years: "2022–2025", avail: "both", priceLow: 55000, priceHigh: 95000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","sculpted"], cabin: ["tech","quiet","visibility","seats"],
    reliability: "mid", techComplexity: "high", depreciation: "mid", efficiency: "high", uniqueness: "high", seats: 7, luxury: true, power: ["ev"],
    visceral: "An electric adventure machine for the family — silent, hugely capable off-road, and full of clever touches.",
    watchOut: "Big, heavy, pricey to insure, and the service network is still growing.",
    proTip: "The three-row R1S is the family pick; check for remaining warranty on used examples." },
  { name: "Rivian R1T", years: "2022–2025", avail: "both", priceLow: 50000, priceHigh: 90000,
    body: "truck", drive: "commanding", aesthetic: ["rugged","sculpted"], cabin: ["tech","quiet","visibility","seats"],
    reliability: "mid", techComplexity: "high", depreciation: "mid", efficiency: "high", uniqueness: "high", seats: 5, luxury: true, power: ["ev"],
    visceral: "The electric adventure pickup — quick, quiet, wildly capable, with a clever gear tunnel and a real bed.",
    watchOut: "Big and heavy, costly to insure, and service can mean a wait in some regions.",
    proTip: "The R1T is the truck of the pair; used depreciation has made them far more attainable." },
  { name: "Lucid Air", years: "2022–2024", avail: "both", priceLow: 60000, priceHigh: 120000,
    body: "sedan", drive: "smooth", aesthetic: ["sculpted","elegant"], cabin: ["quiet","premium","tech","sound","smell"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "high", seats: 5, luxury: true, power: ["ev"],
    visceral: "Astonishing range and a hushed, jewel-like cabin — it out-luxuries cars costing far more.",
    watchOut: "Young company, so long-term support and resale are still unproven.",
    proTip: "Early depreciation is steep, which makes a lightly used Air a lot of luxury per dollar." },
  { name: "Toyota Tacoma", years: "2016–2024", avail: "both", priceLow: 22000, priceHigh: 48000,
    body: "truck", drive: "commanding", aesthetic: ["rugged"], cabin: ["visibility","simple","seats"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "low", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "Go-anywhere midsize toughness with legendary resale — it shrugs off abuse and barely loses value.",
    watchOut: "Stiff, trucky ride and a tight back seat; thirsty for its size.",
    proTip: "TRD Off-Road and Pro trims hold value best — even high-mile ones stay pricey for good reason." },
  { name: "Ford F-150", years: "2015–2024", avail: "both", priceLow: 20000, priceHigh: 70000,
    body: "truck", drive: "commanding", aesthetic: ["rugged"], cabin: ["visibility","seats","tech"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "low", seats: 6, luxury: false,
    visceral: "Do-everything capability — tow, haul, and road-trip in genuine comfort; the truck that quietly does it all.",
    watchOut: "Big to park, modest fuel economy, and trims swing wildly in price.",
    proTip: "The 2.7L EcoBoost V6 is the sweet spot — strong, efficient enough, and cheaper than the bigger engines." },
  { name: "Ford Maverick", years: "2022–2024", avail: "both", priceLow: 22000, priceHigh: 38000,
    body: "truck", drive: "commanding", aesthetic: ["rugged","minimal"], cabin: ["simple","seats"],
    reliability: "mid", techComplexity: "mid", depreciation: "low", efficiency: "high", uniqueness: "high", seats: 5, luxury: false,
    visceral: "A right-sized truck that sips fuel — the standard hybrid makes it feel almost guilt-free, and it parks like a car.",
    watchOut: "Modest towing and a plasticky cabin; so popular they can be hard to find used.",
    proTip: "The hybrid is the one to get — remarkable mpg for a pickup and barely costs more." },

  { name: "Toyota Sienna", years: "2021–2024", avail: "both", priceLow: 30000, priceHigh: 55000,
    body: "minivan", drive: "smooth", aesthetic: ["sculpted"], cabin: ["quiet","seats","visibility"],
    reliability: "high", techComplexity: "mid", depreciation: "low", efficiency: "high", uniqueness: "mid", seats: 8, luxury: false,
    visceral: "The quietly genius family hauler — a standard hybrid that sips fuel, sliding doors, and a flat floor that makes everyday life absurdly easy.",
    watchOut: "Not remotely exciting to drive, and clean used ones hold their price stubbornly.",
    proTip: "It's hybrid-only and gets ~36 mpg — astonishing for something this roomy. AWD is worth it in snow country." },
  { name: "Honda Odyssey", years: "2018–2024", avail: "both", priceLow: 24000, priceHigh: 52000,
    body: "minivan", drive: "balanced", aesthetic: ["sculpted"], cabin: ["seats","visibility","sound"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 8, luxury: false,
    visceral: "The minivan that's secretly fun to drive — clever second-row seats, a built-in cabin camera for the kids, and Honda bones underneath.",
    watchOut: "Gas-only, so not as thrifty as the Sienna; some early infotainment quirks.",
    proTip: "The Magic Slide second row is a genuine family superpower — try it before you write off vans." },
  { name: "Kia Carnival", years: "2022–2024", avail: "both", priceLow: 30000, priceHigh: 50000,
    body: "minivan", drive: "smooth", aesthetic: ["sculpted","aggressive"], cabin: ["seats","tech","visibility"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 8, luxury: false,
    visceral: "A minivan that looks like an SUV and loads like a lounge — the most stylish way to admit you've embraced the van life.",
    watchOut: "No AWD or hybrid option, and it's newer so long-term reliability is less proven.",
    proTip: "The SX trim's VIP lounge seats rival cars costing twice as much." },
  { name: "Chrysler Pacifica", years: "2020–2024", avail: "both", priceLow: 26000, priceHigh: 55000,
    body: "minivan", drive: "smooth", aesthetic: ["sculpted"], cabin: ["seats","quiet","tech"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "high", uniqueness: "mid", seats: 7, luxury: false,
    visceral: "The only plug-in-hybrid minivan — Stow 'n Go seats vanish into the floor, and you can run errands on pure electric.",
    watchOut: "Reliability is middling and the plug-in version costs more up front.",
    proTip: "If your daily driving is short, the PHEV does most of it on electricity — huge savings over a year." },

  { name: "Cadillac Escalade", years: "2021–2024", avail: "both", priceLow: 55000, priceHigh: 130000,
    body: "suv", drive: "commanding", aesthetic: ["aggressive","elegant"], cabin: ["premium","quiet","seats","tech"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "mid", seats: 7, luxury: true,
    visceral: "Pure American presence — a curved 38-inch OLED dash, AKG speakers, and a road-filling stance that turns every arrival into an event.",
    watchOut: "Thirsty, huge to park, and the badge commands a premium over its GMC cousin.",
    proTip: "The mechanically-similar GMC Yukon Denali gives ~90% of the experience for noticeably less." },
  { name: "Cadillac CT5", years: "2020–2024", avail: "both", priceLow: 32000, priceHigh: 95000,
    body: "sedan", drive: "balanced", aesthetic: ["aggressive","sculpted"], cabin: ["premium","tech","quiet"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: true,
    visceral: "The sport sedan America almost forgot it could build — crisp rear-drive handling, and in Blackwing form, one of the great enthusiast cars of the era.",
    watchOut: "Cabin materials trail the German rivals; resale is softer than a BMW's.",
    proTip: "A used CT5-V is a tremendous amount of performance for the money — and yes, the Blackwing offers a manual." },
  { name: "Cadillac Lyriq", years: "2023–2024", avail: "both", priceLow: 48000, priceHigh: 80000,
    body: "suv", drive: "smooth", aesthetic: ["sculpted","minimal"], cabin: ["premium","quiet","tech"],
    reliability: "mid", techComplexity: "high", depreciation: "mid", efficiency: "high", uniqueness: "high", seats: 5, luxury: true, power: ["ev"],
    visceral: "A genuinely stunning electric Cadillac — that 33-inch curved screen and serene, silent glide make it feel like the future of American luxury.",
    watchOut: "Early build, newer tech, and charging speed is good-not-great.",
    proTip: "It often undercuts a comparable electric BMW or Mercedes while feeling just as special inside." },

  { name: "Nissan Z", years: "2023–2024", avail: "both", priceLow: 40000, priceHigh: 55000,
    body: "coupe", drive: "connected", aesthetic: ["retro","aggressive"], cabin: ["seats","simple","sound"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "high", seats: 2, luxury: false,
    visceral: "A twin-turbo throwback to when sports cars were affordable and rowdy — gorgeous retro lines and a proper manual that begs to be wrung out.",
    watchOut: "Cheap-feeling interior bits, and demand can push used prices high.",
    proTip: "Get the 6-speed manual — the automatic robs it of half its charm." },
  { name: "Nissan Altima", years: "2019–2024", avail: "both", priceLow: 17000, priceHigh: 35000,
    body: "sedan", drive: "smooth", aesthetic: ["sculpted"], cabin: ["seats","quiet","simple"],
    reliability: "mid", techComplexity: "low", depreciation: "mid", efficiency: "high", uniqueness: "low", seats: 5, luxury: false,
    visceral: "A roomy, comfortable commuter that's one of the few midsize sedans you can get with all-wheel drive — sensible, easy, no drama.",
    watchOut: "The CVT can feel droning, and it's not memorable to drive.",
    proTip: "AWD on a comfy sedan at this price is genuinely rare — great for snowy regions on a budget." },
  { name: "Nissan Rogue", years: "2021–2024", avail: "both", priceLow: 22000, priceHigh: 38000,
    body: "suv", drive: "smooth", aesthetic: ["sculpted"], cabin: ["seats","visibility","quiet"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "low", seats: 5, luxury: false,
    visceral: "A pleasant, easy-to-live-with compact SUV — comfy seats, good visibility, and a cabin nicer than the price suggests.",
    watchOut: "The little turbo-three engine sounds gruff; not a driver's car.",
    proTip: "Look at the newer 2021+ generation — a big step up in refinement over the older ones." },
  { name: "Nissan Ariya", years: "2023–2024", avail: "both", priceLow: 36000, priceHigh: 55000,
    body: "suv", drive: "smooth", aesthetic: ["minimal","sculpted"], cabin: ["quiet","tech","premium"],
    reliability: "mid", techComplexity: "high", depreciation: "mid", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false, power: ["ev"],
    visceral: "A calm, beautifully minimalist electric SUV — the lounge-like cabin with its sliding console feels like a quiet Japanese living room.",
    watchOut: "Charging speed and range trail the best rivals; newer model with limited track record.",
    proTip: "Its serene interior is the standout — sit in one before deciding, it's a vibe." },

  { name: "Chevrolet Silverado 1500", years: "2019–2024", avail: "both", priceLow: 28000, priceHigh: 70000,
    body: "truck", drive: "commanding", aesthetic: ["rugged","aggressive"], cabin: ["seats","visibility","tech"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "low", seats: 6, luxury: false,
    visceral: "A do-anything full-size workhorse — tow, haul, road-trip — with a huge range of trims from bare-bones to near-luxury.",
    watchOut: "Base interiors feel cheap, and fuel economy is thirsty.",
    proTip: "The available diesel is a torquey, surprisingly efficient sleeper for big towing." },
  { name: "Chevrolet Tahoe", years: "2021–2025", avail: "both", priceLow: 45000, priceHigh: 85000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","elegant"], cabin: ["seats","visibility","premium"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "low", seats: 8, luxury: false,
    visceral: "A full-size three-row that tows heavy and hauls the whole crew in comfort, with real road presence.",
    watchOut: "Big to park and thirsty; the base engine works hard when loaded.",
    proTip: "The available diesel returns shockingly good highway mpg for something this size." },
  { name: "Chevrolet Suburban", years: "2021–2025", avail: "both", priceLow: 48000, priceHigh: 90000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","elegant"], cabin: ["seats","visibility","premium"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "low", seats: 8, luxury: false,
    visceral: "The Tahoe's stretched sibling — cavernous cargo behind the third row swallows a whole family's gear and then some.",
    watchOut: "Enormous to park and thirsty; only worth the length if you truly need the extra space.",
    proTip: "If you don't need the giant cargo hold, save money and get the shorter Tahoe instead." },
  { name: "Chevrolet Equinox", years: "2018–2024", avail: "both", priceLow: 18000, priceHigh: 35000,
    body: "suv", drive: "smooth", aesthetic: ["sculpted"], cabin: ["seats","visibility","simple"],
    reliability: "mid", techComplexity: "low", depreciation: "mid", efficiency: "mid", uniqueness: "low", seats: 5, luxury: false,
    visceral: "An honest, affordable little SUV that just does the job — easy to park, easy to own, easy on the wallet.",
    watchOut: "Modest power and an unremarkable drive; interior is functional, not plush.",
    proTip: "One of the better values in a cheap used compact SUV — and the new Equinox EV is a lot of electric car for the money." },
  { name: "Chevrolet Camaro", years: "2016–2024", avail: "used", priceLow: 24000, priceHigh: 60000,
    body: "coupe", drive: "connected", aesthetic: ["aggressive","muscular"], cabin: ["seats","simple","sound"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "mid", seats: 4, luxury: false,
    visceral: "A genuinely sharp-handling muscle car — the SS and especially the 1LE corner like a sports car while sounding like thunder.",
    watchOut: "Terrible outward visibility and a cramped back seat; now discontinued.",
    proTip: "The 1LE handling package is the enthusiast's pick — and a manual SS used is a steal for the performance." },
  { name: "Chevrolet Bolt EV", years: "2020–2023", avail: "used", priceLow: 16000, priceHigh: 27000,
    body: "hatchback", drive: "smooth", aesthetic: ["minimal"], cabin: ["simple","tech","seats"],
    reliability: "mid", techComplexity: "high", depreciation: "high", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false, power: ["ev"],
    visceral: "The most affordable way into a real EV — peppy around town, ~250 miles of range, and almost free to run.",
    watchOut: "Slow public charging and basic interior; check that the battery recall was completed.",
    proTip: "Used Bolts are one of the best EV bargains on the planet right now — just confirm the battery was replaced." },

  { name: "Dodge Charger", years: "2015–2023", avail: "both", priceLow: 24000, priceHigh: 80000,
    body: "sedan", drive: "balanced", aesthetic: ["aggressive","muscular"], cabin: ["seats","sound","simple"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "high", seats: 5, luxury: false,
    visceral: "A four-door muscle car with attitude — the only family sedan that can come with a supercharged Hellcat V8 and available all-wheel drive.",
    watchOut: "Aging platform, thirsty V8s, and a dated interior.",
    proTip: "The V6 AWD is a sleeper for snowy climates; the Scat Pack is the V8 sweet spot." },
  { name: "Dodge Challenger", years: "2015–2023", avail: "used", priceLow: 26000, priceHigh: 75000,
    body: "coupe", drive: "connected", aesthetic: ["retro","aggressive"], cabin: ["seats","sound","simple"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "high", seats: 5, luxury: false,
    visceral: "Unapologetic retro muscle — a thunderous V8, a usable back seat, and the last of the old-school American coupes you can still row yourself.",
    watchOut: "Big and heavy, not a corner-carver, and now discontinued.",
    proTip: "The R/T Scat Pack with the 6-speed manual is the classic pick before these become collectibles." },
  { name: "Ram 1500", years: "2019–2024", avail: "both", priceLow: 28000, priceHigh: 75000,
    body: "truck", drive: "commanding", aesthetic: ["rugged","elegant"], cabin: ["premium","quiet","seats"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "mid", seats: 6, luxury: false,
    visceral: "The truck that rides like a luxury car — its coil-spring rear suspension and quiet, plush cabin make long hauls genuinely comfortable.",
    watchOut: "Some reported reliability niggles; loaded versions get expensive fast.",
    proTip: "The available air suspension and that 12-inch screen make higher trims feel like a Range Rover for less." },

  { name: "Toyota Corolla", years: "2020–2024", avail: "both", priceLow: 17000, priceHigh: 30000,
    body: "sedan", drive: "smooth", aesthetic: ["sculpted"], cabin: ["seats","simple","quiet"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "high", uniqueness: "low", seats: 5, luxury: false,
    visceral: "The definition of dependable — it'll start every morning for 200,000 miles, and the hybrid sips fuel like a scooter.",
    watchOut: "Not thrilling to drive; the base engine is leisurely.",
    proTip: "The hybrid costs little more and returns ~50 mpg — the smartest cheap-commuter buy there is." },
  { name: "Hyundai Elantra", years: "2021–2024", avail: "both", priceLow: 17000, priceHigh: 35000,
    body: "sedan", drive: "balanced", aesthetic: ["aggressive","sculpted"], cabin: ["seats","tech","simple"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "high", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "A dramatically-styled compact that punches way above its price — and in N form, a genuine hot rod with a manual and a riotous exhaust.",
    watchOut: "Firm ride on sportier trims; some earlier engines had issues, so check history.",
    proTip: "The Elantra N is one of the best-value performance cars made; the hybrid is the thrifty everyday pick." },
  { name: "Kia Soul", years: "2020–2024", avail: "both", priceLow: 15000, priceHigh: 26000,
    body: "hatchback", drive: "smooth", aesthetic: ["minimal","retro"], cabin: ["seats","simple","visibility"],
    reliability: "mid", techComplexity: "low", depreciation: "mid", efficiency: "mid", uniqueness: "high", seats: 5, luxury: false,
    visceral: "A cheerful little box with surprising space and personality — upright, easy to see out of, and genuinely fun to own.",
    watchOut: "FWD only, modest power, and the boxy shape means some wind noise.",
    proTip: "Roomier inside than its tiny footprint suggests — a clever city car on a budget." },
  { name: "Mazda3", years: "2019–2024", avail: "both", priceLow: 19000, priceHigh: 35000,
    body: "sedan", drive: "connected", aesthetic: ["sculpted","elegant"], cabin: ["premium","quiet","seats"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "The compact that feels like a baby luxury car — beautifully sculpted, a hushed upscale cabin, and steering that actually talks to you.",
    watchOut: "Tighter back seat and smaller trunk than rivals; touchpad-style infotainment takes adjustment.",
    proTip: "The hatchback with the manual and the turbo engine is a quietly brilliant enthusiast's daily." },
  { name: "Subaru Crosstrek", years: "2018–2024", avail: "both", priceLow: 20000, priceHigh: 35000,
    body: "suv", drive: "balanced", aesthetic: ["rugged"], cabin: ["visibility","seats","simple"],
    reliability: "high", techComplexity: "low", depreciation: "low", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "A pint-sized adventure-mobile — standard all-wheel drive, real ground clearance, and a manual on base trims for the purists.",
    watchOut: "Modestly powered, so highway merges take planning.",
    proTip: "Standard AWD at this price plus legendary resale make it a fantastic active-lifestyle value." },
  { name: "Honda HR-V", years: "2023–2024", avail: "both", priceLow: 24000, priceHigh: 32000,
    body: "suv", drive: "smooth", aesthetic: ["sculpted"], cabin: ["seats","visibility","simple"],
    reliability: "high", techComplexity: "low", depreciation: "mid", efficiency: "high", uniqueness: "low", seats: 5, luxury: false,
    visceral: "A right-sized, easy little SUV with Honda's bulletproof reliability and a comfy, sensible cabin — perfect first-SUV territory.",
    watchOut: "Underpowered for highway passing; not exciting in any way.",
    proTip: "The newer 2023+ model rides and looks far nicer than the old one — worth seeking out." },

  { name: "Subaru WRX", years: "2015–2024", avail: "both", priceLow: 22000, priceHigh: 45000,
    body: "sedan", drive: "connected", aesthetic: ["aggressive"], cabin: ["seats","simple","sound"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "high", seats: 5, luxury: false,
    visceral: "A rally car for the street — turbo punch, standard all-wheel-drive grip, and a manual that makes a rainy back road feel like a special stage.",
    watchOut: "Firm ride, boy-racer image, and you must check for hard-driven/modified examples.",
    proTip: "Buy from a careful adult owner with records — a well-kept WRX is one of the great all-weather fun cars." },
  { name: "Toyota Supra", years: "2020–2024", avail: "both", priceLow: 38000, priceHigh: 60000,
    body: "coupe", drive: "connected", aesthetic: ["sculpted","aggressive"], cabin: ["seats","simple","premium"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "high", seats: 2, luxury: false,
    visceral: "A proper rear-drive sports car with a silky BMW-sourced inline-six — fast, balanced, and now available with a real manual gearbox.",
    watchOut: "Tight cabin and limited cargo; BMW underpinnings mean BMW-style upkeep.",
    proTip: "The 3.0L six is the one to have; the 2023+ manual transformed how engaging it feels." },
  { name: "Mini Cooper", years: "2016–2024", avail: "both", priceLow: 16000, priceHigh: 38000,
    body: "hatchback", drive: "connected", aesthetic: ["retro","minimal"], cabin: ["seats","simple"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "high", uniqueness: "high", seats: 4, luxury: false,
    visceral: "Go-kart handling in an adorable retro package — darty, eager, endlessly customizable, and grin-inducing on a twisty road.",
    watchOut: "Cramped rear seat, firm ride, and German-car maintenance costs as they age.",
    proTip: "The Cooper S manual is the sweet spot of fun; budget for upkeep on higher-mileage examples." },

  { name: "Toyota Highlander", years: "2020–2024", avail: "both", priceLow: 30000, priceHigh: 55000,
    body: "suv", drive: "smooth", aesthetic: ["sculpted"], cabin: ["seats","quiet","visibility"],
    reliability: "high", techComplexity: "mid", depreciation: "low", efficiency: "mid", uniqueness: "low", seats: 8, luxury: false,
    visceral: "The no-regrets three-row family SUV — rock-solid reliability, an efficient hybrid option, and the kind of resale that makes accountants smile.",
    watchOut: "Third row is tight for adults; not engaging to drive.",
    proTip: "The hybrid barely sacrifices power and returns ~35 mpg in a three-row — a rare combo." },
  { name: "Hyundai Palisade", years: "2020–2024", avail: "both", priceLow: 28000, priceHigh: 55000,
    body: "suv", drive: "smooth", aesthetic: ["elegant","sculpted"], cabin: ["premium","quiet","seats"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 8, luxury: false,
    visceral: "A three-row that feels a class above its price — quilted-leather Calligraphy trims rival luxury badges for thousands less.",
    watchOut: "Newer nameplate with a shorter track record than the Toyota.",
    proTip: "The Calligraphy trim is the value-luxury play of the segment — genuinely plush." },
  { name: "Jeep Grand Cherokee", years: "2021–2024", avail: "both", priceLow: 28000, priceHigh: 70000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","elegant"], cabin: ["premium","seats","visibility"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 5, luxury: false,
    visceral: "Genuine off-road capability wrapped in a surprisingly upscale cabin — it'll ford a stream on the way to a nice dinner.",
    watchOut: "Reliability is middling and fuel economy unremarkable; loaded trims get pricey.",
    proTip: "The 4xe plug-in hybrid can do short trips on electric; the L adds a usable third row." },
  { name: "Ford Explorer", years: "2020–2024", avail: "both", priceLow: 25000, priceHigh: 55000,
    body: "suv", drive: "balanced", aesthetic: ["sculpted"], cabin: ["seats","visibility","tech"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "low", seats: 7, luxury: false,
    visceral: "A rear-drive-based three-row that's more eager than most family SUVs — and the ST version is genuinely quick.",
    watchOut: "Early builds of this generation had quality gremlins; check history.",
    proTip: "The ST is a sleeper hot-rod hauler; the hybrid is the efficiency pick." },
  { name: "Mazda CX-90", years: "2024", avail: "both", priceLow: 38000, priceHigh: 60000,
    body: "suv", drive: "balanced", aesthetic: ["sculpted","elegant"], cabin: ["premium","quiet","seats"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 8, luxury: false,
    visceral: "Mazda's near-luxury three-row — a smooth inline-six, a beautifully crafted cabin, and the most engaging drive of any family hauler at the price.",
    watchOut: "Third row is best for kids; newest model so reliability is still unproven.",
    proTip: "Cross-shop it against entry luxury SUVs — it feels every bit as nice for less." },

  { name: "Lincoln Navigator", years: "2020–2024", avail: "both", priceLow: 50000, priceHigh: 110000,
    body: "suv", drive: "smooth", aesthetic: ["elegant"], cabin: ["premium","quiet","seats","smell"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "low", uniqueness: "mid", seats: 8, luxury: true,
    visceral: "A rolling first-class lounge — 30-way massaging seats, a hushed cabin, and effortless turbocharged power that makes a road trip feel like a spa day.",
    watchOut: "Enormous, thirsty, and depreciation is steep on the big trims.",
    proTip: "Because they depreciate hard, a 2–3 year-old Navigator is staggering luxury per dollar." },
  { name: "Land Rover Defender", years: "2020–2024", avail: "both", priceLow: 48000, priceHigh: 90000,
    body: "suv", drive: "commanding", aesthetic: ["rugged","aggressive"], cabin: ["premium","visibility","seats"],
    reliability: "low", techComplexity: "high", depreciation: "mid", efficiency: "low", uniqueness: "high", seats: 7, luxury: true,
    visceral: "Properly go-anywhere, yet plush enough for the school run — it has more character and presence than almost anything on the road.",
    watchOut: "Land Rover reliability is a real concern; budget for upkeep and an extended warranty.",
    proTip: "Lease or buy with a warranty rather than owning one long out of coverage." },
  { name: "Range Rover Sport", years: "2018–2024", avail: "both", priceLow: 45000, priceHigh: 120000,
    body: "suv", drive: "smooth", aesthetic: ["elegant","sculpted"], cabin: ["premium","quiet","smell"],
    reliability: "low", techComplexity: "high", depreciation: "high", efficiency: "low", uniqueness: "high", seats: 5, luxury: true,
    visceral: "Old-money cool — a serene, commanding glide with genuine off-road ability and an interior that smells like success.",
    watchOut: "Reliability and depreciation are both rough; repairs are expensive.",
    proTip: "Let someone else eat the first three years of depreciation and always buy with coverage." },
  { name: "Acura MDX", years: "2022–2024", avail: "both", priceLow: 35000, priceHigh: 68000,
    body: "suv", drive: "balanced", aesthetic: ["sculpted","aggressive"], cabin: ["premium","seats","quiet"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "mid", seats: 7, luxury: true,
    visceral: "The sensible luxury three-row — Honda reliability underneath, a genuinely nice cabin, and the Type S version is quietly quick.",
    watchOut: "Third row is snug; infotainment dial takes getting used to.",
    proTip: "It's the reliability play in luxury three-rows — and the Type S adds real performance." },
  { name: "BMW X3", years: "2018–2024", avail: "both", priceLow: 28000, priceHigh: 65000,
    body: "suv", drive: "balanced", aesthetic: ["sculpted"], cabin: ["premium","quiet","tech"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "low", seats: 5, luxury: true,
    visceral: "The default smart luxury compact SUV — it drives like a sport sedan on stilts, and the M40i is genuinely fast.",
    watchOut: "Options add up fast, and out-of-warranty BMW upkeep isn't cheap.",
    proTip: "A CPO X3 is the safe way in; the M40i is the enthusiast's pick if budget allows." },
  { name: "Audi Q5", years: "2018–2024", avail: "both", priceLow: 28000, priceHigh: 60000,
    body: "suv", drive: "smooth", aesthetic: ["elegant","sculpted"], cabin: ["premium","quiet","tech","smell"],
    reliability: "mid", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "low", seats: 5, luxury: true,
    visceral: "Understated, beautifully built, and quietly excellent — the Q5's cabin is a serene, tasteful place that never tries too hard.",
    watchOut: "Less engaging to drive than the BMW; German maintenance costs apply.",
    proTip: "Standard Quattro AWD and a cabin that ages gracefully make a used one a comfortable bet." },
  { name: "Genesis GV70", years: "2022–2024", avail: "both", priceLow: 38000, priceHigh: 65000,
    body: "suv", drive: "balanced", aesthetic: ["elegant","sculpted"], cabin: ["premium","quiet","smell","tech"],
    reliability: "high", techComplexity: "mid", depreciation: "mid", efficiency: "mid", uniqueness: "high", seats: 5, luxury: true,
    visceral: "The luxury SUV that embarrasses the establishment — gorgeous materials, a long warranty, and the twin-turbo version is properly rapid.",
    watchOut: "Smaller dealer network; resale isn't yet at German levels.",
    proTip: "Cross-shop it against an X3 or Q5 and you'll be amazed what you get for the money." },
];

// Cars that also offer a hybrid variant (detected by name prefix; EVs set power explicitly)
const HYBRID_CAPABLE = ["Lexus ES", "Toyota Camry", "Honda Accord", "Jeep Wrangler",
  "Volvo XC90", "Lexus RX", "Toyota Land Cruiser", "Hyundai Santa Fe", "Honda CR-V", "BMW 3 Series", "Ford Maverick",
  "Toyota Sienna", "Chrysler Pacifica", "Toyota Corolla", "Hyundai Elantra", "Toyota Highlander"];
function carPowertrains(car) {
  if (car.power) return car.power;
  if (HYBRID_CAPABLE.some(n => car.name.startsWith(n))) return ["gas", "hybrid"];
  return ["gas"];
}

// Cars that offer (or offered) a manual transmission. Few are left, so a "manual"
// dealbreaker is a strong *boost*, not a hard filter — we don't want to strand people.
const MANUAL_MODELS = ["MX-5", "GR86", "BRZ", "718", "Cayman", "M2", "Civic",
  "Corvette", "GTI", "Golf R", "Mustang GT", "Tacoma", "Nissan Z", "Camaro", "Challenger",
  "Elantra", "Mazda3", "Crosstrek", "WRX", "Supra", "Mini"];
function carHasManual(car) {
  return MANUAL_MODELS.some(m => car.name.includes(m));
}
// Cars available with AWD/4WD. Virtually all SUVs and trucks offer it, plus these models.
const AWD_MODELS = ["Audi", "Outback", "Genesis", "Volvo", "Tesla", "Rivian", "Lucid",
  "Polestar", "Ioniq", "EV6", "Mach-E", "BMW 3 Series", "E-Class", "Acura TLX", "iX", "i4",
  "Sienna", "Pacifica", "WRX", "Altima", "Charger", "CT5"];
function carHasAWD(car) {
  if (car.body === "suv" || car.body === "truck" || car.body === "minivan") return car.body === "suv" || car.body === "truck" ? true : car.name.includes("Sienna") || car.name.includes("Pacifica");
  return AWD_MODELS.some(m => car.name.includes(m));
}

// Infer the *character* of the cars a person says they loved, so we can steer
// the whole recommendation set toward that DNA (luxury, drive feel, body, look).
const LUX_BRANDS = ["mercedes", "benz", "bmw", "audi", "lexus", "porsche", "genesis",
  "jaguar", "cadillac", "lincoln", "infiniti", "acura", "volvo", "land rover", "range rover",
  "maserati", "bentley", "rolls", "aston", "ferrari", "lamborghini", "tesla", "rivian",
  "lucid", "polestar", "alfa romeo", "alfa"];
const SPORTY_HINTS = ["porsche", "corvette", "mustang", " m2", " m3", " m4", " m5", "miata",
  "mx-5", "mx5", "gti", "golf r", "brz", "gr86", " 86", "cayman", "911", "type r", "type-r",
  " si ", "amg", "supra", "370z", "350z", "z4", "boxster", "gt3", "shelby", "hellcat", "raptor"];
const RUGGED_HINTS = ["jeep", "wrangler", "bronco", "4runner", "raptor", "tacoma", "tundra",
  "truck", "land cruiser", "defender", "gladiator", "off-road", "offroad", "overland"];

function inferLovedProfile(lovedCars) {
  if (!lovedCars || !lovedCars.length) return null;
  const text = lovedCars.map(c => (c.name + " " + (c.loved || []).join(" ")).toLowerCase()).join(" | ");
  const profile = { luxury: 0, sporty: 0, rugged: 0, commanding: 0, comfort: 0, drives: {}, aesthetics: {}, bodies: {} };

  LUX_BRANDS.forEach(b => { if (text.includes(b)) profile.luxury += 1; });
  if (/luxur|premium|plush|opulent|first.class|high.end|upscale|refined|cosset/.test(text)) profile.luxury += 1;
  SPORTY_HINTS.forEach(h => { if (text.includes(h)) profile.sporty += 1; });
  RUGGED_HINTS.forEach(h => { if (text.includes(h)) profile.rugged += 1; });

  // Descriptor words people actually type (beyond brand/model names)
  if (/\bfast\b|quick|sporty|nimble|agile|handl|corner|grip|track|responsive|punchy|peppy|zippy|tight steering|pure fun|made me grin|thrill|exciting|exhilarat/.test(text)) profile.sporty += 1;
  if (/capable|rugged|off.?road|tough|go.?anywhere|trail|overland|4x4|four.?wheel|tow|haul|adventure/.test(text)) profile.rugged += 1;
  if (/visibility|see everything|sit.{0,5}high|commanding|sit.{0,5}tall|high.up|elevated/.test(text)) profile.commanding += 1;
  if (/quiet|smooth|comfort|serene|hush|isolat|cabin/.test(text)) profile.comfort += 1;

  // If a loved car matches one in our database, inherit its DNA.
  // Match on MODEL-distinctive tokens (not brand) so loving a "Toyota GR86"
  // doesn't accidentally inherit DNA from a Toyota 4Runner.
  const BRAND_WORDS = ["toyota", "honda", "mazda", "subaru", "kia", "hyundai", "ford",
    "chevrolet", "chevy", "volkswagen", "vw", "nissan", "jeep", "bmw", "audi", "lexus",
    "mercedes", "benz", "mercedes-benz", "porsche", "genesis", "volvo", "acura", "tesla",
    "rivian", "lucid", "polestar", "cadillac", "lincoln", "hyundai", "alfa"];
  CAR_DB.forEach(car => {
    const distinctive = car.name.toLowerCase().split(/[\s/]+/)
      .filter(t => t.length > 2 && !BRAND_WORDS.includes(t)
        && !["the", "and", "series", "class", "incl", "type"].includes(t));
    if (distinctive.some(t => text.includes(t))) {
      profile.drives[car.drive] = (profile.drives[car.drive] || 0) + 1;
      car.aesthetic.forEach(x => profile.aesthetics[x] = (profile.aesthetics[x] || 0) + 1);
      profile.bodies[car.body] = (profile.bodies[car.body] || 0) + 1;
      if (car.luxury) profile.luxury += 1;
    }
  });

  return profile;
}

function tierFromBudget(b) {
  if (!b) return [0, 999999];
  if (b.startsWith("Under $400")) return [0, 20000];
  if (b.startsWith("$400")) return [12000, 42000];
  if (b.startsWith("$700")) return [30000, 75000];
  if (b.startsWith("$1,200")) return [60000, 120000];
  if (b.startsWith("$2,000")) return [90000, 999999];
  return [0, 999999];
}

// Cash buyers think in total price, not monthly.
function cashTier(b) {
  if (!b) return [0, 999999];
  if (b.startsWith("Under $15")) return [0, 15000];
  if (b.startsWith("$15")) return [12000, 30000];
  if (b.startsWith("$30")) return [25000, 60000];
  if (b.startsWith("$60")) return [50000, 100000];
  if (b.startsWith("$100")) return [90000, 999999];
  return [0, 999999];
}

// Convert the budget answer into an actual car-price range, based on HOW they pay.
// Leasing stretches a monthly budget to pricier cars; cash uses total price directly.
function priceTier(a) {
  if (a.paymentMethod === "cash") return cashTier(a.cashBudget);
  const [lo, hi] = tierFromBudget(a.monthlyBudget);
  if (a.paymentMethod === "lease") return [Math.round(lo * 1.4), Math.round(hi * 1.6)];
  return [lo, hi];
}

function scoreCars(a, bias, prevBudgetHigh) {
  const [budgetLow, budgetHigh] = priceTier(a);
  const lovedText = a.lovedCars.map(c => (c.name + " " + c.loved.join(" ")).toLowerCase()).join(" ");
  const lovedProfile = inferLovedProfile(a.lovedCars);

  // map vibe answers (multi-select) to aesthetic tags
  const vibeMap = {
    "Sculpted": "sculpted", "Clean": "minimal", "Bold": "aggressive",
    "Retro": "retro", "Rugged": "rugged", "Elegant": "elegant",
  };
  const vibeTags = [];
  (Array.isArray(a.vibe) ? a.vibe : a.vibe ? [a.vibe] : []).forEach(v => {
    for (const k in vibeMap) if (v.startsWith(k) && !vibeTags.includes(vibeMap[k])) vibeTags.push(vibeMap[k]);
  });

  // map drive answer(s) — now multi-select
  const driveArr = Array.isArray(a.driveStyle) ? a.driveStyle : a.driveStyle ? [a.driveStyle] : [];
  const driveTags = [];
  driveArr.forEach(d => {
    if (d.startsWith("Connected") && !driveTags.includes("connected")) driveTags.push("connected");
    else if (d.startsWith("Spirited") && !driveTags.includes("balanced")) driveTags.push("balanced");
    else if (d.startsWith("Smooth") && !driveTags.includes("smooth")) driveTags.push("smooth");
    else if (d.startsWith("Commanding") && !driveTags.includes("commanding")) driveTags.push("commanding");
    else if (d.startsWith("Easy") && !driveTags.includes("easy")) driveTags.push("easy");
  });

  // cabin priority → tags
  const cabinWants = [];
  a.cabinPriorities.forEach(c => {
    if (c.startsWith("Quiet")) cabinWants.push("quiet");
    if (c.startsWith("Premium")) cabinWants.push("premium");
    if (c.startsWith("Great sound")) cabinWants.push("sound");
    if (c.startsWith("Perfect seats")) cabinWants.push("seats");
    if (c.startsWith("Big windows")) cabinWants.push("visibility");
    if (c.startsWith("Simple")) cabinWants.push("simple");
    if (c.startsWith("Tech-forward")) cabinWants.push("tech");
    if (c.startsWith("A special smell")) cabinWants.push("smell");
  });

  // hidden factors
  const wantReliable = a.hiddenFactors.some(f => f.startsWith("Reliability"));
  const hateTech = a.hiddenFactors.some(f => f.startsWith("I hate complicated"));
  const wantCheapMaint = a.hiddenFactors.some(f => f.startsWith("Maintenance costs"));
  const wantResale = a.hiddenFactors.some(f => f.startsWith("I want a car that holds"));
  const wantUnique = a.hiddenFactors.some(f => f.startsWith("I want something unique"));
  const wantEfficient = a.hiddenFactors.some(f => f.startsWith("I care about fuel"));

  let techPref = null;
  if (a.techComfort?.startsWith("Keep it simple")) techPref = "low";
  else if (a.techComfort?.startsWith("Modern but")) techPref = "mid";
  else if (a.techComfort?.startsWith("Give me everything")) techPref = "high";

  // seats need — max across selected passenger counts (multi-select)
  const passArr = Array.isArray(a.passengers) ? a.passengers : a.passengers ? [a.passengers] : [];
  let seatsNeed = 2;
  passArr.forEach(p => {
    let n = 2;
    if (p.startsWith("Just me")) n = 2;
    else if (p.startsWith("Me and one")) n = 2;
    else if (p.startsWith("Family of 3-4")) n = 5;
    else if (p.startsWith("5+")) n = 7;
    if (n > seatsNeed) seatsNeed = n;
  });

  // primary use (multi-select) helpers
  const useArr = Array.isArray(a.primaryUse) ? a.primaryUse : a.primaryUse ? [a.primaryUse] : [];
  const useHas = (kw) => useArr.some(u => u.startsWith(kw));

  // body bias from use + cargo
  const wantsSpace = a.cargoNeeds?.startsWith("Serious") || useHas("I work out of") || seatsNeed >= 7;

  // ownership length → reliability weight
  const longKeep = a.ownershipLength?.startsWith("5-7") || a.ownershipLength?.startsWith("As long");

  // used openness
  const lovesUsed = a.openToUsed?.startsWith("Absolutely");
  const prefersNew = a.openToUsed?.startsWith("I prefer new");

  const rank = { high: 3, mid: 2, low: 1 };

  return CAR_DB.map(car => {
    let s = 0;
    const reasons = [];

    // powertrain (hard gate — a wrong powertrain is a dealbreaker, never show it)
    const ptArr = Array.isArray(a.powertrain) ? a.powertrain : a.powertrain ? [a.powertrain] : [];
    const ptActive = ptArr.filter(p => p && p !== "any");
    if (ptActive.length > 0 && !ptArr.includes("any")) {
      if (ptActive.some(p => carPowertrains(car).includes(p))) { s += 28; }
      else { s -= 200; }
    }

    // budget fit — HARD ceiling. Over-budget cars are gated out (like a wrong powertrain)
    // so leans (luxury/sport/etc.) re-rank strictly WITHIN budget.
    const carMid = (car.priceLow + car.priceHigh) / 2;
    const isBudgetUp = bias === "budgetUp" && prevBudgetHigh && prevBudgetHigh < 900000;
    if (isBudgetUp) {
      // "Higher budget" lean: raise BOTH the floor and the ceiling. A car's midpoint must
      // sit inside the new, higher band — so nothing cheaper than this band can slip in,
      // and pricier cars get a nudge toward the top.
      if (carMid >= budgetLow && carMid <= budgetHigh) {
        s += 30;
        s += Math.min(20, (carMid - budgetLow) / 3000);
        if (car.luxury) s += 6;
      } else {
        s -= 200; // too cheap OR too expensive for the raised band = gated out
      }
    } else {
      if (car.priceLow <= budgetHigh && car.priceHigh >= budgetLow) { s += 30; }
      else if (carMid < budgetLow && budgetLow > 0) {
        // Cheaper than budget — allowed, but increasingly disfavored the further below it sits,
        // so a much-cheaper car can't headline for someone with a big budget.
        const ratio = carMid / budgetLow;
        if (ratio >= 0.75) s += 2;        // just under budget — still appropriate
        else if (ratio >= 0.5) s -= 25;   // noticeably cheaper — disfavored
        else s -= 120;                    // far below budget — don't let it headline
      }
      else { s -= 200; } // over budget = gated out
    }

    // aesthetic (any selected look that matches; small bonus for matching more than one)
    const aMatches = vibeTags.filter(t => car.aesthetic.includes(t)).length;
    if (aMatches >= 1) { s += 22; reasons.push("looks"); }
    if (aMatches >= 2) s += 6;

    // drive — match any selected feel
    if (driveTags.length && driveTags.includes(car.drive)) { s += 26; reasons.push("drive"); }
    else if (driveTags.includes("balanced") && (car.drive === "connected" || car.drive === "smooth")) s += 10;
    else if (driveTags.includes("connected") && car.drive === "balanced") s += 10;
    else if (driveTags.includes("easy") && (car.drive === "smooth" || car.drive === "balanced")) s += 8;

    // cabin
    cabinWants.forEach(w => { if (car.cabin.includes(w)) { s += 8; } });
    if (cabinWants.includes("simple") && car.techComplexity === "low") s += 6;
    if (cabinWants.includes("tech") && car.techComplexity === "high") s += 6;

    // hidden factors
    if (wantReliable) s += (rank[car.reliability] - 2) * 12;
    if (hateTech) s += (2 - rank[car.techComplexity]) * 12;
    if (wantCheapMaint) s += car.luxury ? -6 : 6;
    if (wantResale) s += (2 - rank[car.depreciation]) * 10;
    if (wantUnique) s += (rank[car.uniqueness] - 2) * 10;
    if (wantEfficient) s += (rank[car.efficiency] - 2) * 10;

    // tech preference alignment
    if (techPref === "low") s += (2 - rank[car.techComplexity]) * 8;
    if (techPref === "high") s += (rank[car.techComplexity] - 2) * 6;

    // seats
    if (car.seats >= seatsNeed) s += 10;
    else s -= 25;

    // space/body
    if (wantsSpace && (car.body === "suv" || car.body === "wagon" || car.body === "minivan")) s += 12;
    if (!wantsSpace && useHas("Weekend") && (car.body === "coupe" || car.body === "convertible")) s += 8;

    // dealbreakers (optional). Body requirements are hard gates; manual/AWD are strong nudges.
    const db = a.dealbreakers || [];
    if (db.length) {
      const mustBodies = [];
      if (db.includes("Must be a truck / pickup")) mustBodies.push("truck");
      if (db.includes("Must be an SUV / crossover")) mustBodies.push("suv");
      if (db.includes("Must be a convertible")) mustBodies.push("convertible");
      if (mustBodies.length && !mustBodies.includes(car.body)) s -= 200;
      if (db.includes("No SUVs or trucks — just a car") && (car.body === "suv" || car.body === "truck")) s -= 200;
      if (db.includes("Manual transmission") && carHasManual(car)) s += 40;
      if (db.includes("All-wheel / 4-wheel drive")) s += carHasAWD(car) ? 22 : -22;
    }

    // ownership length favors reliability
    if (longKeep) s += (rank[car.reliability] - 2) * 8;

    // used preference
    if (lovesUsed && (car.avail === "used" || car.avail === "both")) s += 8;
    if (prefersNew && car.avail === "used") s -= 18;
    if (prefersNew && car.avail === "new") s += 6;

    // ─── LOVED-CAR DNA (the most important signal) ───
    // We listen hard to what someone already loved and steer toward that character.
    if (lovedProfile) {
      // Same brand as something they loved — a meaningful nudge
      const brand = car.name.split(/[\s/]+/)[0].toLowerCase();
      if (lovedText.includes(brand)) { s += 16; reasons.push("brand"); }

      // Luxury: if they loved luxury cars, strongly favor luxury and de-emphasize the rest
      if (lovedProfile.luxury >= 1) {
        if (car.luxury) s += 24 + Math.min(lovedProfile.luxury, 4) * 5;
        else s -= 16;
      }
      // Sporty: loved enthusiast cars → favor engaging drives
      if (lovedProfile.sporty >= 1 && (car.drive === "connected" || car.drive === "balanced")) s += 18;
      // Rugged: loved trucks/off-roaders → favor rugged SUVs
      if (lovedProfile.rugged >= 1 && car.body === "suv" && car.aesthetic.includes("rugged")) s += 18;
      // Commanding: loved high-up, high-visibility cars → favor those
      if (lovedProfile.commanding >= 1 && (car.drive === "commanding" || car.cabin.includes("visibility"))) s += 12;
      // Comfort: loved quiet, smooth, cosseting cars → favor those
      if (lovedProfile.comfort >= 1 && (car.drive === "smooth" || car.cabin.includes("quiet"))) s += 10;

      // Inherited DNA from specifically-recognized loved cars
      if (lovedProfile.drives[car.drive]) s += 14;
      if (car.aesthetic.some(x => lovedProfile.aesthetics[x])) s += 10;
      if (lovedProfile.bodies[car.body]) s += 8;

      // Free-text feel keywords (kept as a light extra signal)
      if (/(analog|raw|connected|engaging|fun|nimble|grin|joy|smile|playful)/.test(lovedText) && car.drive === "connected") s += 8;
      if (/(quiet|smooth|comfort|serene)/.test(lovedText) && car.drive === "smooth") s += 8;
      if (/(reliable|dependable|never|forever|bulletproof)/.test(lovedText) && car.reliability === "high") s += 8;
      if (/(sound|exhaust|v8|engine note|loud)/.test(lovedText) && car.cabin.includes("sound")) s += 8;
    }

    // directional bias (from "show me more, leaning X" on results screen)
    if (bias === "sport") {
      if (car.drive === "connected") s += 26; else if (car.drive === "balanced") s += 13;
      if (car.aesthetic.includes("aggressive") || car.aesthetic.includes("sculpted")) s += 8;
      if (["coupe", "convertible", "hatchback"].includes(car.body)) s += 10;
    } else if (bias === "comfort") {
      if (car.drive === "smooth") s += 26; else if (car.drive === "commanding") s += 10;
      if (car.cabin.includes("quiet")) s += 12;
      if (car.cabin.includes("premium")) s += 8;
    } else if (bias === "luxury") {
      if (car.luxury) s += 26;
      if (car.cabin.includes("premium")) s += 8;
      if (car.cabin.includes("smell")) s += 6;
    } else if (bias === "practical") {
      s += (rank[car.reliability] - 2) * 14;
      s += (rank[car.efficiency] - 2) * 8;
      if (["suv", "wagon", "sedan"].includes(car.body)) s += 8;
      if (car.seats >= 5) s += 6;
    }

    // determine new vs used display
    let displayAvail = car.avail;
    if (car.avail === "both") displayAvail = (lovesUsed || carMid > budgetHigh * 0.7) ? "used" : "new";

    return { ...car, score: s, displayAvail };
  }).sort((x, y) => y.score - x.score);
}

// ─── CAR PHOTOS ───
// Real photos are served by imagin.studio via a shared demo key. For production
// (reliability + full coverage), swap IMAGIN_KEY for your own customer key, or a
// CarImages key. Anything that doesn't resolve falls back to a clean gold frame.
const IMAGIN_KEY = "hrjavascript-mastery";
// Preview-safe default: render the built-in gold silhouettes (no external image calls).
// On the live site, flip this to true for real make/model photos.
const SHOW_REAL_PHOTOS = true;
function carPhotoUrl(rawName, year) {
  const clean = rawName.split("(")[0].split(" / ")[0].trim();
  const parts = clean.split(" ");
  const make = parts[0];
  const model = parts.slice(1).join(" ").replace(/\b(350|1500|LS|LX|EX|C7|C8)\b/g, "").trim();
  return `https://cdn.imagin.studio/getimage?customer=${IMAGIN_KEY}` +
    `&make=${encodeURIComponent(make)}&modelFamily=${encodeURIComponent(model)}` +
    (year ? `&modelYear=${year}` : "") +
    `&angle=23&fileType=png&width=640`;
}

function CarPhoto({ name, body, year }) {
  const [failed, setFailed] = useState(false);
  const frame = {
    position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 12,
    overflow: "hidden", marginBottom: 16,
    background: "radial-gradient(120% 100% at 50% 0%, rgba(207,170,90,0.10), rgba(255,255,255,0.02) 60%)",
    border: "1px solid rgba(255,255,255,0.06)",
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  if (!SHOW_REAL_PHOTOS || failed) {
    return (
      <div style={frame}>
        <svg viewBox="0 0 120 46" width="58%" style={{ opacity: 0.5 }} fill="none"
          stroke="#cfaa5a" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
          <path d="M6 34 L14 34 M106 34 L114 34 M14 34 Q14 24 24 23 L38 13 Q45 10 60 10 L78 11 Q90 12 98 22 L108 24 Q114 25 114 32 L114 34" />
          <circle cx="34" cy="35" r="7" fill="#1b1915" /><circle cx="86" cy="35" r="7" fill="#1b1915" />
        </svg>
        <span style={{ position: "absolute", bottom: 8, fontSize: 10.5, letterSpacing: 2,
          textTransform: "uppercase", color: "rgba(237,232,220,0.35)", fontFamily: "'DM Sans', sans-serif" }}>
          {body || "vehicle"}
        </span>
      </div>
    );
  }
  return (
    <div style={frame}>
      <img src={carPhotoUrl(name, year)} alt={name} onError={() => setFailed(true)}
        loading="lazy" decoding="async"
        style={{ width: "100%", height: "100%", objectFit: "contain", padding: "6px 10px" }} />
    </div>
  );
}

// Fetches a live price range from our /api/car-data service, falling back to the
// car's stored estimate while loading or if anything fails (so it can never break).
// ~7.5% APR, 72-month loan, $0 down — a conservative monthly estimate. Always shown
// alongside the total, never hiding it (the opposite of the dealership's monthly trick).
function monthlyPayment(principal) {
  const r = 0.075 / 12, n = 72;
  return Math.round((principal * r / (1 - Math.pow(1 + r, -n))) / 5) * 5;
}
const totalLabel = (lo, hi) => `$${Math.round(lo / 1000)}K – $${Math.round(hi / 1000)}K`;
const monthlyLabel = (lo, hi) => `≈$${monthlyPayment(lo)}–$${monthlyPayment(hi)}/mo`;

function useLivePrice(car) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!car || !car._key) return;
    let alive = true;
    const clean = car._key.split("(")[0].split(" / ")[0].trim();
    const parts = clean.split(" ");
    const make = parts[0];
    const model = parts.slice(1).join(" ");
    if (!make || !model) return;
    const q = new URLSearchParams({ make, model });
    if (car.yearRange) q.set("year", car.yearRange);
    try {
      fetch(`/api/car-data?${q.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d && typeof d.priceLow === "number" && typeof d.priceHigh === "number") setLive(d);
        })
        .catch(() => {});
    } catch (e) { /* no-op: keep the stored fallback */ }
    return () => { alive = false; };
  }, [car && car._key]);
  const low = live ? live.priceLow : (car ? car.priceLowNum : 0);
  const high = live ? live.priceHigh : (car ? car.priceHighNum : 0);
  return { low, high };
}

function MoreRow({ car, finance }) {
  const { low, high } = useLivePrice(car);
  const price = finance ? monthlyLabel(low, high) : totalLabel(low, high);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 12, padding: "13px 16px", marginBottom: 9 }}>
      <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 20, color: "#ede8dc", lineHeight: 1.1 }}>{car.name}</span>
      <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
        color: car.newOrUsed === "used" ? "#82ad6a" : "#cfaa5a" }}>{car.newOrUsed} · {price}</span>
    </div>
  );
}

function ZeroInOption({ label, sub, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer",
      background: selected ? "rgba(207,170,90,0.14)" : "rgba(255,255,255,0.03)",
      border: `1.5px solid ${selected ? "#cfaa5a" : "rgba(255,255,255,0.08)"}`,
      borderRadius: 14, padding: "16px 18px", marginBottom: 10, color: "#ede8dc",
      fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s ease",
    }}>
      <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: sub ? 3 : 0 }}>{label}</div>
      {sub && <div style={{ fontSize: 13, color: "rgba(237,232,220,0.5)", lineHeight: 1.45 }}>{sub}</div>}
    </button>
  );
}

function ZeroIn({ car, answers, onBack, onNavigate }) {
  const [step, setStep] = useState(0);
  const [trim, setTrim] = useState(null);
  const [condition, setCondition] = useState(null);
  const [comfortable, setComfortable] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [mileage, setMileage] = useState(null);
  const { low, high } = useLivePrice(car);
  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  const K = { bg: "#1b1915", gold: "#cfaa5a", text: "#ede8dc", dim: "rgba(237,232,220,0.55)",
    faint: "rgba(237,232,220,0.35)", red: "#e0694f", green: "#82ad6a", line: "rgba(255,255,255,0.08)" };
  const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : n; };
  const STEPS = ["trim", "condition", "budget", "mileage", "target"];
  const cur = STEPS[step];
  const name = car.name;

  const canNext = () => {
    if (cur === "trim") return !!trim;
    if (cur === "condition") return !!condition;
    if (cur === "budget") return num(comfortable) > 0;
    if (cur === "mileage") return !!mileage;
    return true;
  };

  // Sharpen the full range into a target sub-range from their choices.
  const range = Math.max(0, high - low);
  const conditionPos = condition === "new" ? 0.72 : 0.34;
  const trimAdj = trim === "loaded" ? 0.16 : trim === "essentials" ? -0.16 : 0;
  const mileAdj = mileage === "high" ? -0.06 : mileage === "low" ? 0.06 : 0;
  const center = Math.min(0.88, Math.max(0.16, conditionPos + trimAdj + mileAdj));
  const round1k = (n) => Math.round(n / 1000) * 1000;
  const tLow = round1k(low + Math.max(0, center - 0.13) * range);
  const tHigh = round1k(low + Math.min(1, center + 0.13) * range);
  const tMoHigh = monthlyPayment(tHigh);

  const comfMo = num(comfortable), ceilMo = num(ceiling);
  let budget = null;
  if (comfMo > 0) {
    if (tMoHigh <= comfMo) budget = { level: "green", msg: `That lands comfortably inside your $${comfMo}/mo — no stretching needed. Nicely done.` };
    else if (ceilMo > 0 && tMoHigh <= ceilMo) budget = { level: "gold", msg: `This nudges toward the top of your range (about $${tMoHigh}/mo vs your $${comfMo}/mo comfort zone). You can — but remember, every $50/mo you don't spend is roughly $3,600 back in your pocket over a 6-year loan.` };
    else budget = { level: "red", msg: `Heads up — this target runs past even your ceiling. Rather than stretch, pull one of the levers below and stay honest to your budget.` };
  }

  const yearGuide = condition === "new" ? "the newest one or two model years"
    : "roughly 3–5 years old — where the steepest depreciation is already behind it";
  const trimWord = trim === "loaded" ? "a top trim" : trim === "essentials" ? "a base or mid trim" : "a mid trim";
  const mileWord = mileage === "low" ? "lower-mileage" : mileage === "high" ? "higher-mileage" : "average-mileage";
  const levers = ["Drop one trim level", "Go a year or two older", "Accept a few more miles on a reliable car"];

  const wrap = (children) => (
    <div style={{ minHeight: "100vh", background: K.bg, color: K.text, fontFamily: "'DM Sans', sans-serif", padding: "28px 20px 60px", maxWidth: 560, margin: "0 auto" }}>
      <style>{`*{box-sizing:border-box;} input:focus{outline:none;border-color:rgba(207,170,90,0.5)!important;}`}</style>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "rgba(207,170,90,0.75)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, fontWeight: 600, padding: "2px 0", marginBottom: 14 }}>‹ Back to matches</button>
      <div style={{ letterSpacing: 2, fontSize: 11, fontWeight: 700, color: K.gold, marginBottom: 18 }}>ZERO IN · {name.toUpperCase()}</div>
      {children}
    </div>
  );
  const dots = (
    <div style={{ display: "flex", gap: 6, marginBottom: 26 }}>
      {STEPS.slice(0, 4).map((s, i) => (
        <div key={s} style={{ flex: 1, height: 3, borderRadius: 3, background: i <= Math.min(step, 3) ? K.gold : "rgba(255,255,255,0.09)" }} />
      ))}
    </div>
  );
  const nextBtn = (
    <button onClick={() => setStep(step + 1)} disabled={!canNext()} style={{
      width: "100%", marginTop: 20, padding: "15px", borderRadius: 14, cursor: canNext() ? "pointer" : "default",
      background: canNext() ? K.gold : "rgba(255,255,255,0.06)", color: canNext() ? "#1b1915" : "rgba(237,232,220,0.3)",
      border: "none", fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 700,
    }}>Continue</button>
  );
  const h1 = (t) => <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 33, lineHeight: 1.1, margin: "0 0 8px" }}>{t}</h1>;
  const sub = (t) => <p style={{ color: K.dim, fontSize: 14.5, lineHeight: 1.5, margin: "0 0 22px" }}>{t}</p>;
  const field = (label, val, set, ph) => (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, color: K.faint, marginBottom: 6 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: K.faint }}>$</span>
        <input inputMode="decimal" value={val} onChange={(e) => set(e.target.value)} placeholder={ph}
          style={{ width: "100%", padding: "12px 12px 12px 24px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: `1.5px solid ${K.line}`, color: K.text, fontSize: 15, fontFamily: "'DM Sans', sans-serif" }} />
      </div>
    </label>
  );

  if (cur === "trim") return wrap(<>{dots}{h1("How dressed-up do you want it?")}{sub("No need to know trim names — just the vibe.")}
    <ZeroInOption label="Just the essentials" sub="Save the money; skip the fancy stuff." selected={trim === "essentials"} onClick={() => setTrim("essentials")} />
    <ZeroInOption label="A few nice touches" sub="Comfortable middle — the popular choice." selected={trim === "middle"} onClick={() => setTrim("middle")} />
    <ZeroInOption label="Load it up" sub="Leather, tech, the good stuff." selected={trim === "loaded"} onClick={() => setTrim("loaded")} />
    {nextBtn}</>);

  if (cur === "condition") return wrap(<>{dots}{h1("Brand new, or smart used?")}{sub("A gently-used one is often ~25–30% cheaper for ~90% of the car.")}
    <ZeroInOption label="Brand new" sub="Latest model, full warranty — for a premium." selected={condition === "new"} onClick={() => setCondition("new")} />
    <ZeroInOption label="Let someone else eat the depreciation" sub="A few years old — the smart-money sweet spot." selected={condition === "used"} onClick={() => setCondition("used")} />
    {nextBtn}</>);

  if (cur === "budget") {
    const gap = ceilMo > 0 && comfMo > 0 && ceilMo > comfMo;
    return wrap(<>{dots}{h1("What's the real budget?")}{sub("Two numbers keep us honest — the comfortable one, and the never-past-this one.")}
      {field("Comfortable monthly payment", comfortable, setComfortable, "300")}
      {field("Absolute ceiling (optional)", ceiling, setCeiling, "400")}
      {gap && (
        <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.55, color: K.dim, background: "rgba(207,170,90,0.07)", border: "1px solid rgba(207,170,90,0.22)", borderRadius: 12, padding: "12px 14px" }}>
          We'll aim for your <strong style={{ color: K.text }}>comfortable</strong> number and only reach toward the ceiling if we truly have to. Every $50/mo you don't spend is about <strong style={{ color: K.text }}>$3,600</strong> saved over a 6-year loan — money that stays yours.
        </div>
      )}
      {nextBtn}</>);
  }

  if (cur === "mileage") return wrap(<>{dots}{h1("How do you feel about miles?")}{sub("On a reliable car, higher miles ≠ trouble — and they save you plenty.")}
    <ZeroInOption label="Lowest miles I can get" sub="Peace of mind; pay a bit more." selected={mileage === "low"} onClick={() => setMileage("low")} />
    <ZeroInOption label="A sensible middle" sub="Balance price and peace of mind." selected={mileage === "balanced"} onClick={() => setMileage("balanced")} />
    <ZeroInOption label="Higher miles are fine if it saves money" sub="Smart on a dependable car." selected={mileage === "high"} onClick={() => setMileage("high")} />
    {nextBtn}</>);

  // target screen
  return wrap(<>
    <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 34, lineHeight: 1.12, margin: "0 0 16px" }}>Here's your target.</h1>
    <div style={{ border: "1px solid rgba(207,170,90,0.35)", background: "rgba(207,170,90,0.06)", borderRadius: 16, padding: "20px", marginBottom: 16 }}>
      <div style={{ fontSize: 12, letterSpacing: 1.5, fontWeight: 700, color: K.gold, marginBottom: 10 }}>GO SHOP FOR</div>
      <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 23, lineHeight: 1.3, color: K.text, marginBottom: 14 }}>
        {trimWord}, {mileWord} {name} — {yearGuide}.
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div><div style={{ fontSize: 11.5, color: K.faint, marginBottom: 2 }}>Target price</div>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, color: K.gold }}>{totalLabel(tLow, tHigh)}</div></div>
        <div><div style={{ fontSize: 11.5, color: K.faint, marginBottom: 2 }}>Roughly</div>
          <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 26, color: K.text }}>{monthlyLabel(tLow, tHigh)}</div></div>
      </div>
    </div>

    {budget && (
      <div style={{ border: `1px solid ${budget.level === "green" ? "rgba(130,173,106,0.4)" : budget.level === "gold" ? "rgba(207,170,90,0.4)" : "rgba(224,105,79,0.4)"}`,
        background: budget.level === "green" ? "rgba(130,173,106,0.08)" : budget.level === "gold" ? "rgba(207,170,90,0.07)" : "rgba(224,105,79,0.08)",
        borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, letterSpacing: 1.5, fontWeight: 700, marginBottom: 6, color: budget.level === "green" ? K.green : budget.level === "gold" ? K.gold : K.red }}>
          {budget.level === "green" ? "YOU'RE IN GREAT SHAPE" : "AN HONEST BUDGET CHECK"}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: K.dim }}>{budget.msg}</div>
        {budget.level !== "green" && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: K.faint, marginBottom: 6 }}>Levers to stay comfortable:</div>
            {levers.map((l, i) => (<div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: K.gold }}>›</span><span style={{ fontSize: 13.5, color: K.dim }}>{l}</span></div>))}
          </div>
        )}
      </div>
    )}

    <div style={{ border: `1px solid ${K.line}`, background: "rgba(255,255,255,0.02)", borderRadius: 14, padding: "16px 18px", marginBottom: 16, fontSize: 13, lineHeight: 1.55, color: K.dim }}>
      <strong style={{ color: K.text }}>Smart-buyer benchmark (optional):</strong> the 20/3/8 rule — ~20% down, keep the loan to 3 years, payments under 8% of take-home. A gut-check the pros swear by.
    </div>

    <button onClick={() => onNavigate && onNavigate("decoder")} style={{ width: "100%", padding: "15px", borderRadius: 14, cursor: "pointer", background: K.gold, color: "#1b1915", border: "none", fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Found one? Decode the deal →</button>
    <button onClick={onBack} style={{ width: "100%", padding: "14px", borderRadius: 14, cursor: "pointer", background: "transparent", color: K.dim, border: `1px solid ${K.line}`, fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600 }}>‹ Back to matches</button>

    <div style={{ fontSize: 11.5, color: K.faint, lineHeight: 1.5, marginTop: 16, textAlign: "center" }}>
      Target prices are estimates from current listings and your choices — a smart starting point, not an exact quote.
    </div>
  </>);
}

function CarMatchmaker({ onHome, onNavigate }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({
    lovedCars: [],
    currentCarInput: "",
    currentLoveInput: [],
    currentLoveText: "",
    powertrain: [],
    vibe: [],
    driveStyle: [],
    cabinPriorities: [],
    hiddenFactors: [],
    passengers: [],
    primaryUse: [],
    dealbreakers: [],
    cargoNeeds: null,
    paymentMethod: "finance",
    monthlyBudget: null,
    cashBudget: null,
    openToUsed: null,
    ownershipLength: null,
    techComfort: null,
  });
  const [results, setResults] = useState(null);
  const [zeroInCar, setZeroInCar] = useState(null);
  const [extraBatches, setExtraBatches] = useState([]);
  const [loadingMore, setLoadingMore] = useState(null);
  const [showWarranty, setShowWarranty] = useState(false);
  const [showPowerInfo, setShowPowerInfo] = useState(false);
  const [showPayInfo, setShowPayInfo] = useState(false);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);

  const currentStep = STEPS[step];

  useEffect(() => {
    window.scrollTo(0, 0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [step]);

  const goNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };
  const update = (key, val) => setAnswers((a) => ({ ...a, [key]: val }));
  const toggleMulti = (key, val) => {
    setAnswers((a) => {
      const curr = a[key] || [];
      return { ...a, [key]: curr.includes(val) ? curr.filter((v) => v !== val) : [...curr, val] };
    });
  };

  const addLovedCar = () => {
    if (!answers.currentCarInput.trim()) return;
    const newCar = {
      name: answers.currentCarInput.trim(),
      loved: [...answers.currentLoveInput],
    };
    update("lovedCars", [...answers.lovedCars, newCar]);
    update("currentCarInput", "");
    update("currentLoveInput", []);
  };

  const removeLovedCar = (idx) => {
    update("lovedCars", answers.lovedCars.filter((_, i) => i !== idx));
  };

  // ─── AI RECOMMENDATION ───
  const loadingStepIdx = STEPS.findIndex(s => s.id === "loading");
  const resultsStepIdx = STEPS.findIndex(s => s.id === "results");
  const ownershipStepIdx = STEPS.findIndex(s => s.id === "ownership");

  const getRecommendations = () => {
    setStep(loadingStepIdx);
    setError(null);
    setExtraBatches([]);
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });

    // Brief delay so the loading animation feels intentional, then compute locally
    setTimeout(() => {
      try {
        const ranked = scoreCars(answers);
        const top3 = ranked.slice(0, 3);
        if (top3.length === 0) throw new Error("No matches");

        const cars = top3.map(c => buildCarDisplay(c, answers));
        const more = ranked.slice(3, 6).filter(c => c.score > -100).map(c => buildCarDisplay(c, answers));
        const philosophy = buildPhilosophy(answers, top3);
        setResults({ cars, more, philosophy });
        setStep(resultsStepIdx);
      } catch (err) {
        console.error("Scoring error:", err);
        setError("Something went wrong. Tap below to try again.");
      }
    }, 1600);
  };

  // Turn a scored car into a display object (shared by initial + "show more")
  function buildCarDisplay(c, a) {
    const years = (c.years || "").match(/\d{4}/g);
    return {
      _key: c.name,
      name: c.name,
      body: c.body,
      year: years ? years[years.length - 1] : null,
      yearRange: c.years ? c.years.replace(/[–—]/g, "-").replace(/\s+/g, "") : null,
      newOrUsed: c.displayAvail,
      priceRange: `$${(c.priceLow / 1000).toFixed(0)}K – $${(c.priceHigh / 1000).toFixed(0)}K`,
      priceLowNum: c.priceLow,
      priceHighNum: c.priceHigh,
      whyThisCar: whyCar(c, a),
      visceral: c.visceral,
      watchOut: c.watchOut,
      proTip: c.proTip,
    };
  }

  function bumpBudget(b) {
    if (!b) return "$700 – $1,200/month";
    if (b.startsWith("Under $400")) return "$400 – $700/month";
    if (b.startsWith("$400")) return "$700 – $1,200/month";
    if (b.startsWith("$700")) return "$1,200 – $2,000/month";
    if (b.startsWith("$1,200")) return "$2,000+/month";
    return null; // already at top
  }
  function bumpCash(b) {
    if (!b) return "$30k – $60k";
    if (b.startsWith("Under $15")) return "$15k – $30k";
    if (b.startsWith("$15")) return "$30k – $60k";
    if (b.startsWith("$30")) return "$60k – $100k";
    if (b.startsWith("$60")) return "$100k+";
    return null; // already at top
  }

  // "Show me three more, leaning in a direction"
  const showMore = (kind) => {
    setLoadingMore(kind);
    setTimeout(() => {
      let mods = answers;
      let bias = null;
      let label = "";
      let prevHigh = null;
      if (kind === "sport") { bias = "sport"; label = "Leaning more driver-focused"; }
      else if (kind === "comfort") { bias = "comfort"; label = "Leaning more comfort & calm"; }
      else if (kind === "luxury") { bias = "luxury"; label = "Leaning more luxury"; }
      else if (kind === "practical") { bias = "practical"; label = "Leaning more practical & reliable"; }
      else if (kind === "budgetUp") {
        prevHigh = priceTier(answers)[1];
        if (answers.paymentMethod === "cash") {
          const bumped = bumpCash(answers.cashBudget);
          mods = { ...answers, cashBudget: bumped || answers.cashBudget };
          label = bumped ? "With a higher budget" : "At your top budget";
        } else {
          const bumped = bumpBudget(answers.monthlyBudget);
          mods = { ...answers, monthlyBudget: bumped || answers.monthlyBudget };
          label = bumped ? "With a higher budget" : "At your top budget";
        }
        bias = "budgetUp";
      }

      // Exclude everything already shown
      const shown = new Set([
        ...(results?.cars || []).map(c => c._key),
        ...extraBatches.flatMap(b => b.cars.map(c => c._key)),
      ]);

      const next = scoreCars(mods, bias, prevHigh)
        .filter(c => !shown.has(c.name))
        .slice(0, 3)
        .map(c => buildCarDisplay(c, mods));

      if (next.length > 0) {
        setExtraBatches(prev => [...prev, { label, cars: next }]);
      } else {
        setExtraBatches(prev => [...prev, { label: "That's every car in our garage that fits — try adjusting your answers for more", cars: [] }]);
      }
      setLoadingMore(null);
    }, 700);
  };

  // Generate a personalized "why these" intro + per-car reasoning from the answers
  function buildPhilosophy(a, picks) {
    const bits = [];
    const dArr = Array.isArray(a.driveStyle) ? a.driveStyle : a.driveStyle ? [a.driveStyle] : [];
    if (dArr.some(d => d.startsWith("Connected"))) bits.push("your love of a connected, alive driving feel");
    else if (dArr.some(d => d.startsWith("Smooth"))) bits.push("your preference for a smooth, serene ride");
    else if (dArr.some(d => d.startsWith("Commanding"))) bits.push("your taste for a commanding, high seating position");
    else if (dArr.some(d => d.startsWith("Spirited"))) bits.push("your want for something spirited yet composed");
    else if (dArr.some(d => d.startsWith("Easy"))) bits.push("your want for something easy and effortless");

    if (a.hiddenFactors.some(f => f.startsWith("Reliability"))) bits.push("a strong emphasis on reliability");
    if (a.hiddenFactors.some(f => f.startsWith("I hate complicated"))) bits.push("a desire to avoid frustrating tech");
    if (a.openToUsed?.startsWith("Absolutely")) bits.push("an openness to a smart used buy");

    const lead = bits.length
      ? `These three balance ${bits.slice(0, 3).join(", ")}.`
      : "These three balance how you want the car to look, feel, and fit your life and budget.";
    return lead + " Each is a meaningfully different path to a car you'll genuinely love living with.";
  }

  // Build a personalized "why this car" sentence from matched attributes
  function whyCar(car, a) {
    const parts = [];
    const vibeArr = Array.isArray(a.vibe) ? a.vibe : a.vibe ? [a.vibe] : [];
    const vibeMap = { "Sculpted": "sculpted", "Clean": "minimal", "Bold": "aggressive",
      "Retro": "retro", "Rugged": "rugged", "Elegant": "elegant" };
    const vibeMatch = vibeArr.some(v => {
      for (const k in vibeMap) if (v.startsWith(k) && car.aesthetic.includes(vibeMap[k])) return true;
      return false;
    });
    if (vibeMatch) parts.push("its look lines up with the style you're drawn to");

    const dArr = Array.isArray(a.driveStyle) ? a.driveStyle : a.driveStyle ? [a.driveStyle] : [];
    if (dArr.some(d => d.startsWith("Connected")) && car.drive === "connected") parts.push("it delivers the connected, alive feel you want");
    else if (dArr.some(d => d.startsWith("Smooth")) && car.drive === "smooth") parts.push("it gives you the smooth, serene ride you're after");
    else if (dArr.some(d => d.startsWith("Commanding")) && car.drive === "commanding") parts.push("it offers the commanding, planted feel you like");
    else if (dArr.some(d => d.startsWith("Spirited")) && car.drive === "balanced") parts.push("it's spirited yet composed, exactly your sweet spot");
    else if (dArr.some(d => d.startsWith("Easy")) && (car.drive === "smooth" || car.drive === "balanced")) parts.push("it's easy and effortless, just how you like it");

    if (a.hiddenFactors.some(f => f.startsWith("Reliability")) && car.reliability === "high") parts.push("it has the rock-solid reliability you flagged as critical");
    if (a.hiddenFactors.some(f => f.startsWith("I hate complicated")) && car.techComplexity === "low") parts.push("its controls stay refreshingly simple");
    if (a.cabinPriorities.some(c => c.startsWith("Quiet")) && car.cabin.includes("quiet")) parts.push("the cabin is genuinely hushed");
    if (a.openToUsed?.startsWith("Absolutely") && (car.displayAvail === "used")) parts.push("buying it used stretches your budget further");

    const lovedBrand = a.lovedCars.some(lc => lc.name.toLowerCase().includes(car.name.split(" ")[0].toLowerCase()));
    if (lovedBrand) parts.push(`it shares DNA with a car you already loved`);

    const ptArr = Array.isArray(a.powertrain) ? a.powertrain : a.powertrain ? [a.powertrain] : [];
    if (ptArr.includes("ev") && carPowertrains(car).includes("ev")) parts.push("it's the fully electric setup you asked for");
    else if (ptArr.includes("hybrid") && carPowertrains(car).includes("hybrid")) parts.push("it comes in the hybrid form you wanted");

    const db = a.dealbreakers || [];
    if (db.includes("Manual transmission") && carHasManual(car)) parts.push("it can still be had with a proper manual");
    if (db.includes("All-wheel / 4-wheel drive") && carHasAWD(car)) parts.push("it's available with all-wheel drive");
    if ((db.includes("Must be a truck / pickup")) && car.body === "truck") parts.push("it's the pickup you need");

    if (parts.length === 0) parts.push("it's a strong all-around fit for your budget, space, and priorities");

    const cap = parts.slice(0, 3);
    let sentence = cap.join(", and ");
    sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
    return sentence;
  }

  // ─── RENDER HELPERS ───
  const CarCard = ({ car, rank }) => {
    const ranked = typeof rank === "number";
    const medals = ["🥇", "🥈", "🥉"];
    const rankLabels = ["Best Match", "Strong Alternative", "Dark Horse"];
    const highlight = ranked && rank === 0;
    const { low, high } = useLivePrice(car);
    const finance = answers.paymentMethod === "finance";
    return (
      <div style={{
        background: highlight ? "linear-gradient(135deg, rgba(207,170,90,0.1), rgba(207,170,90,0.02))" : "rgba(255,255,255,0.02)",
        border: highlight ? "1.5px solid rgba(207,170,90,0.3)" : "1.5px solid rgba(255,255,255,0.07)",
        borderRadius: 18, padding: 24, marginBottom: 16,
        animation: `fadeUp 0.5s ease both`,
      }}>
        <CarPhoto name={car._key} body={car.body} year={car.year} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            {ranked && (
              <div style={{ fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                color: highlight ? "#cfaa5a" : "rgba(237,232,220,0.4)",
                letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
                {medals[rank]} {rankLabels[rank]}
              </div>
            )}
            <div style={{ fontSize: highlight ? 24 : 20, fontWeight: 400,
              fontFamily: "'Instrument Serif', serif", color: "#ede8dc", lineHeight: 1.25 }}>
              {car.name}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, marginLeft: 10, gap: 4 }}>
            <div style={{ padding: "5px 12px", borderRadius: 20, fontSize: 11,
              fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
              background: car.newOrUsed === "used" ? "rgba(120,200,120,0.12)" : "rgba(207,170,90,0.12)",
              color: car.newOrUsed === "used" ? "#8c8" : "#cfaa5a",
              border: car.newOrUsed === "used" ? "1px solid rgba(120,200,120,0.25)" : "1px solid rgba(207,170,90,0.25)",
              textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap",
            }}>{car.newOrUsed} · {finance ? monthlyLabel(low, high) : totalLabel(low, high)}</div>
            {finance && (
              <div style={{ fontSize: 10.5, color: "rgba(237,232,220,0.4)", fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap" }}>
                {totalLabel(low, high)} total
              </div>
            )}
          </div>
        </div>

        <div style={{ fontSize: 14, color: "rgba(237,232,220,0.7)", lineHeight: 1.6,
          fontFamily: "'DM Sans', sans-serif", marginBottom: 14 }}>{car.whyThisCar}</div>

        <div style={{ padding: "12px 14px", background: "rgba(255,255,255,0.03)",
          borderRadius: 10, marginBottom: 10, borderLeft: "3px solid rgba(207,170,90,0.3)" }}>
          <div style={{ fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
            color: "#cfaa5a", letterSpacing: "0.1em", marginBottom: 4, textTransform: "uppercase" }}>What it feels like</div>
          <div style={{ fontSize: 13.5, color: "rgba(237,232,220,0.6)", lineHeight: 1.55,
            fontFamily: "'DM Sans', sans-serif" }}>{car.visceral}</div>
        </div>

        <div style={{ padding: "12px 14px", background: "rgba(220,160,80,0.04)",
          borderRadius: 10, marginBottom: 10, borderLeft: "3px solid rgba(220,160,80,0.2)" }}>
          <div style={{ fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
            color: "rgba(237,232,220,0.5)", letterSpacing: "0.1em", marginBottom: 4, textTransform: "uppercase" }}>Watch out for</div>
          <div style={{ fontSize: 13.5, color: "rgba(237,232,220,0.55)", lineHeight: 1.55,
            fontFamily: "'DM Sans', sans-serif" }}>{car.watchOut}</div>
        </div>

        <div style={{ padding: "12px 14px", background: "rgba(120,180,220,0.04)",
          borderRadius: 10, borderLeft: "3px solid rgba(120,180,220,0.2)" }}>
          <div style={{ fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
            color: "rgba(150,200,240,0.7)", letterSpacing: "0.1em", marginBottom: 4, textTransform: "uppercase" }}>Pro tip</div>
          <div style={{ fontSize: 13.5, color: "rgba(237,232,220,0.55)", lineHeight: 1.55,
            fontFamily: "'DM Sans', sans-serif" }}>{car.proTip}</div>
        </div>
        <button onClick={() => setZeroInCar(car)} style={{
          width: "100%", marginTop: 14, padding: "13px", borderRadius: 12, cursor: "pointer",
          background: "rgba(207,170,90,0.12)", color: "#cfaa5a", border: "1px solid rgba(207,170,90,0.35)",
          fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 700,
        }}>Zero in on this one →</button>
      </div>
    );
  };

  const Pill = ({ label, selected, onClick, icon, desc }) => (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 14, width: "100%",
      padding: desc ? "16px 18px" : "14px 18px",
      background: selected ? "rgba(207,170,90,0.1)" : "rgba(255,255,255,0.02)",
      border: selected ? "1.5px solid rgba(207,170,90,0.5)" : "1.5px solid rgba(255,255,255,0.07)",
      borderRadius: 14, cursor: "pointer", textAlign: "left", color: "#ede8dc",
      transition: "all 0.25s ease",
    }}>
      {icon && <span style={{ fontSize: 24, width: 36, textAlign: "center", flexShrink: 0 }}>{icon}</span>}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
          color: selected ? "#cfaa5a" : "#ede8dc" }}>{label}</div>
        {desc && <div style={{ fontSize: 12.5, color: "rgba(237,232,220,0.45)", marginTop: 3,
          lineHeight: 1.4, fontFamily: "'Instrument Serif', serif" }}>{desc}</div>}
      </div>
      {selected && <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#cfaa5a",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ color: "#1b1915", fontSize: 12, fontWeight: 700 }}>✓</span>
      </div>}
    </button>
  );

  const Nav = ({ canNext = true, nextLabel = "Continue", onNext = goNext, showBack = true }) => (
    <div style={{ display: "flex", gap: 12, marginTop: 32 }}>
      {showBack && step > 1 && (
        <button onClick={goBack} style={{ padding: "14px 22px", borderRadius: 50,
          background: "transparent", border: "1.5px solid rgba(255,255,255,0.08)",
          color: "rgba(237,232,220,0.5)", cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500 }}>Back</button>
      )}
      <button onClick={canNext ? onNext : undefined} style={{
        flex: 1, padding: "14px 24px", borderRadius: 50,
        background: canNext ? "linear-gradient(135deg, #cfaa5a, #b8923e)" : "rgba(255,255,255,0.05)",
        border: "none", cursor: canNext ? "pointer" : "default",
        fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 600,
        color: canNext ? "#1b1915" : "rgba(237,232,220,0.2)",
        transition: "all 0.3s ease",
        boxShadow: canNext ? "0 4px 20px rgba(207,170,90,0.2)" : "none",
      }}>{nextLabel}</button>
    </div>
  );

  const SectionTag = ({ label }) => (
    <div style={{ fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
      letterSpacing: "0.18em", textTransform: "uppercase", color: "#cfaa5a", marginBottom: 14 }}>{label}</div>
  );

  const Title = ({ children }) => (
    <h2 style={{ fontSize: 28, fontWeight: 400, fontFamily: "'Instrument Serif', serif",
      letterSpacing: "-0.01em", lineHeight: 1.25, marginBottom: 8, color: "#ede8dc" }}>{children}</h2>
  );

  const Subtitle = ({ children }) => (
    <p style={{ fontSize: 14.5, color: "rgba(237,232,220,0.5)", marginBottom: 28,
      lineHeight: 1.55, fontFamily: "'DM Sans', sans-serif", fontWeight: 400 }}>{children}</p>
  );

  // ─── PROGRESS ───
  const phaseIdx = Object.keys(PHASE_LABELS).indexOf(currentStep.phase);
  const totalPhases = Object.keys(PHASE_LABELS).length;

  // ─── SCREENS ───
  const renderStep = () => {
    switch (currentStep.id) {

      case "welcome":
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", minHeight: "80vh", textAlign: "center" }}>
            <div style={{ fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
              letterSpacing: "0.25em", textTransform: "uppercase", color: "#cfaa5a", marginBottom: 28 }}>
              CAR MATCHMAKER
            </div>
            <h1 style={{ fontSize: 42, fontWeight: 400, fontFamily: "'Instrument Serif', serif",
              lineHeight: 1.15, marginBottom: 18, color: "#ede8dc", maxWidth: 400 }}>
              Every person has a perfect car. Let's find yours.
            </h1>
            <p style={{ fontSize: 15, color: "rgba(237,232,220,0.5)", maxWidth: 380,
              lineHeight: 1.6, marginBottom: 16, fontFamily: "'DM Sans', sans-serif" }}>
              We'll ask about cars you've loved, how you want to feel behind the wheel,
              what fits your life, and what fits your wallet.
            </p>
            <p style={{ fontSize: 13.5, color: "rgba(237,232,220,0.35)", maxWidth: 360,
              lineHeight: 1.6, marginBottom: 44, fontFamily: "'DM Sans', sans-serif", fontStyle: "italic" }}>
              New or used — some of the best cars ever made are available right now for a fraction of their original price. We'll find what's right for you.
            </p>
            <button onClick={goNext} style={{
              padding: "16px 48px", borderRadius: 50,
              background: "linear-gradient(135deg, #cfaa5a, #b8923e)", border: "none",
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 600,
              color: "#1b1915", letterSpacing: "0.02em",
              boxShadow: "0 4px 24px rgba(207,170,90,0.25)",
            }}>Let's Start</button>
            <div style={{ fontSize: 12, color: "rgba(237,232,220,0.25)", marginTop: 18,
              fontFamily: "'DM Sans', sans-serif" }}>About 3 minutes</div>
          </div>
        );

      case "carHistory":
        const buildEntry = () => {
          const combined = [
            ...answers.currentLoveInput,
            ...(answers.currentLoveText?.trim() ? [answers.currentLoveText.trim()] : []),
          ];
          const name = answers.currentCarInput.trim() || (combined.length ? "A car I liked" : "");
          if (!name) return null;
          return { name, loved: combined.length ? combined : ["(just the vibe)"] };
        };
        const handleCarHistoryNext = () => {
          const entry = buildEntry();
          if (entry) {
            setAnswers(a => ({ ...a, lovedCars: [...a.lovedCars, entry],
              currentCarInput: "", currentLoveInput: [], currentLoveText: "" }));
          }
          setStep(2);
        };
        const hasCurrentInput = answers.currentCarInput.trim() || answers.currentLoveInput.length > 0 || answers.currentLoveText?.trim();

        return (<>
          <SectionTag label="Your Car Story" />
          <Title>Tell us about a car you've enjoyed</Title>
          <Subtitle>No need to know the make or model — just tell us what you liked. A rental, a friend's car, your old one... anything counts. (And if nothing comes to mind, that's totally fine — skip ahead.)</Subtitle>

          {answers.lovedCars.map((car, i) => (
            <div key={i} style={{ padding: "14px 16px", background: "rgba(207,170,90,0.08)",
              border: "1px solid rgba(207,170,90,0.2)", borderRadius: 12, marginBottom: 10,
              display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", color: "#cfaa5a" }}>{car.name}</div>
                <div style={{ fontSize: 12, color: "rgba(237,232,220,0.45)", marginTop: 3 }}>{car.loved.join(" · ")}</div>
              </div>
              <button onClick={() => removeLovedCar(i)} style={{ background: "none", border: "none",
                color: "rgba(237,232,220,0.3)", cursor: "pointer", fontSize: 18, padding: "4px 8px" }}>×</button>
            </div>
          ))}

          {/* Descriptive tags — always visible, no name required */}
          <div style={{ fontSize: 13.5, color: "rgba(237,232,220,0.55)", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>What did you like about it? Tap anything that fits:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {["It was comfortable", "Cabin was so quiet", "It felt luxurious", "It felt fast",
              "It was pure fun — made me grin", "It sat up high — I could see everything",
              "It felt rugged & go-anywhere", "It looked amazing", "It turned heads",
              "The seats were perfect", "Great sound system", "It was super reliable",
              "The tech was great", "It just felt like me"
            ].map((trait) => (
              <button key={trait} onClick={() => toggleMulti("currentLoveInput", trait)} style={{
                padding: "8px 14px", borderRadius: 20, fontSize: 13,
                fontFamily: "'DM Sans', sans-serif", fontWeight: 500, cursor: "pointer",
                background: answers.currentLoveInput.includes(trait) ? "rgba(207,170,90,0.15)" : "rgba(255,255,255,0.04)",
                border: answers.currentLoveInput.includes(trait) ? "1px solid rgba(207,170,90,0.4)" : "1px solid rgba(255,255,255,0.06)",
                color: answers.currentLoveInput.includes(trait) ? "#cfaa5a" : "rgba(237,232,220,0.55)",
                transition: "all 0.2s ease",
              }}>{trait}</button>
            ))}
          </div>

          <textarea
            value={answers.currentLoveText || ""}
            onChange={(e) => update("currentLoveText", e.target.value)}
            placeholder="Anything else, in your own words? e.g. 'I loved feeling tucked in and quiet' or 'it was zippy and easy to park'"
            rows={2}
            style={{
              width: "100%", padding: "12px 16px", borderRadius: 12, resize: "none",
              background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(255,255,255,0.08)",
              color: "#ede8dc", fontSize: 14, fontFamily: "'DM Sans', sans-serif",
              outline: "none", lineHeight: 1.5, marginBottom: 16,
            }}
            onFocus={(e) => e.target.style.borderColor = "rgba(207,170,90,0.4)"}
            onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
          />

          {/* Optional name */}
          <div style={{ fontSize: 13, color: "rgba(237,232,220,0.4)", marginBottom: 8,
            fontFamily: "'DM Sans', sans-serif" }}>Happen to know what it was? Add it (totally optional):</div>
          <input
            value={answers.currentCarInput}
            onChange={(e) => update("currentCarInput", e.target.value)}
            placeholder="e.g. Jeep Wrangler, my mom's Lexus, a rental Mustang..."
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 12, marginBottom: 16,
              background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(255,255,255,0.08)",
              color: "#ede8dc", fontSize: 15, fontFamily: "'DM Sans', sans-serif", outline: "none",
            }}
            onFocus={(e) => e.target.style.borderColor = "rgba(207,170,90,0.4)"}
            onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
          />

          {hasCurrentInput && (
            <button onClick={() => {
              const entry = buildEntry();
              if (!entry) return;
              setAnswers(a => ({ ...a, lovedCars: [...a.lovedCars, entry],
                currentCarInput: "", currentLoveInput: [], currentLoveText: "" }));
            }} style={{
              padding: "10px 20px", borderRadius: 50, background: "rgba(207,170,90,0.15)",
              border: "1px solid rgba(207,170,90,0.3)", color: "#cfaa5a", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, marginBottom: 8,
            }}>+ Save this & tell us about another</button>
          )}

          <Nav canNext={true}
            nextLabel={answers.lovedCars.length === 0 && !hasCurrentInput ? "I'm not sure yet — skip" : "Continue"}
            onNext={handleCarHistoryNext} />
        </>);

      case "powertrain":
        return (<>
          <SectionTag label="Power Type" />
          <Title>Gas, hybrid, or electric?</Title>
          <Subtitle>Pick whatever sounds good — or tap more than one if you're open. Not sure? Peek at the quick pros & cons below.</Subtitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { value: "gas", label: "Gas", icon: "⛽",
                desc: "Familiar, fuel up anywhere, the widest selection of cars" },
              { value: "hybrid", label: "Hybrid", icon: "🔋",
                desc: "Big fuel savings, no plugging in required" },
              { value: "ev", label: "Electric", icon: "⚡",
                desc: "Instant, silent, cheapest per mile — best if you can charge at home" },
              { value: "any", label: "I'm open — surprise me", icon: "🤷",
                desc: "Show me the best car regardless of how it's powered" },
            ].map((o) => (
              <Pill key={o.value} label={o.label} icon={o.icon} desc={o.desc}
                selected={answers.powertrain.includes(o.value)} onClick={() => toggleMulti("powertrain", o.value)} />
            ))}
          </div>

          <button onClick={() => setShowPowerInfo(v => !v)} style={{
            marginTop: 14, background: "none", border: "none", color: "#cfaa5a", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, fontWeight: 600, padding: "4px 0",
            display: "flex", alignItems: "center", gap: 6,
          }}>{showPowerInfo ? "▾" : "▸"} Curious? See the pros & cons of each</button>

          {showPowerInfo && (
            <div style={{ marginTop: 10, padding: "16px 18px", background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, fontFamily: "'DM Sans', sans-serif",
              fontSize: 13.5, lineHeight: 1.65, color: "rgba(237,232,220,0.7)" }}>
              <div style={{ marginBottom: 12 }}>
                <strong style={{ color: "#cfaa5a" }}>⛽ Gas</strong><br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Pros:</span> Cheapest to buy, refuel in 5 min anywhere, most choices.<br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Cons:</span> Most expensive to run, more maintenance (oil, etc.).
              </div>
              <div style={{ marginBottom: 12 }}>
                <strong style={{ color: "#cfaa5a" }}>🔋 Hybrid</strong><br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Pros:</span> Way better fuel economy, no charging needed, very reliable. A great "no-homework" middle ground.<br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Cons:</span> Costs a bit more up front than gas.
              </div>
              <div>
                <strong style={{ color: "#cfaa5a" }}>⚡ Electric</strong><br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Pros:</span> Cheapest per mile, almost no maintenance, instant smooth power, quiet.<br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Cons:</span> Best if you can charge at home; road trips need planning.
              </div>
            </div>
          )}

          <Nav canNext={answers.powertrain.length > 0} />
        </>);

      case "vibe":
        return (<>
          <SectionTag label="Visual Taste" />
          <Title>What catches your eye?</Title>
          <Subtitle>When a car makes you look twice in a parking lot — what is it about the design? Tap as many as you like.</Subtitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { value: "Sculpted & flowing — organic curves, athletic stance", icon: "🌊",
                desc: "like a Mazda MX-5, Jaguar F-Type, or Porsche 911" },
              { value: "Clean & minimal — simple lines, understated elegance", icon: "◻️",
                desc: "like a Tesla Model 3, Volvo, or Audi" },
              { value: "Bold & aggressive — wide stance, sharp edges, presence", icon: "🔱",
                desc: "like a Dodge Challenger, BMW M3, or Cadillac Escalade" },
              { value: "Retro & classic — heritage cues, timeless proportions", icon: "📻",
                desc: "like a Ford Bronco, Mini Cooper, or Mustang" },
              { value: "Rugged & capable — built tough, purposeful", icon: "🪨",
                desc: "like a Jeep Wrangler, 4Runner, or Land Rover Defender" },
              { value: "Elegant & refined — luxury without being flashy", icon: "✨",
                desc: "like a Lexus ES, Genesis G80, or Mercedes E-Class" },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon} desc={o.desc} selected={answers.vibe.includes(o.value)}
                onClick={() => toggleMulti("vibe", o.value)} />
            ))}
          </div>
          <Nav canNext={answers.vibe.length > 0} />
        </>);

      case "drive":
        return (<>
          <SectionTag label="The Feel" />
          <Title>You're on a winding road. What do you want?</Title>
          <Subtitle>Go with your gut — and tap more than one if you're torn between a couple.</Subtitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { value: "Connected & alive — I want to feel every ripple, tight steering, I AM the car", icon: "🏎️",
                desc: "Think Porsche Cayman, BMW M2, Mazda MX-5" },
              { value: "Spirited but composed — fun when I want, smooth when I don't", icon: "⚖️",
                desc: "Think BMW 3 Series, Audi S5, Genesis G70" },
              { value: "Smooth & serene — glide over everything, arrive calm", icon: "☁️",
                desc: "Think Lexus ES, Mercedes E-Class, Lincoln" },
              { value: "Commanding & high — sit tall, see everything, feel planted", icon: "🏔️",
                desc: "Think 4Runner, Range Rover, Rivian R1S" },
              { value: "Easy & effortless — light, simple, just gets me there", icon: "🍃",
                desc: "Think Honda Civic, Toyota Corolla, Kia Soul" },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon} desc={o.desc}
                selected={answers.driveStyle.includes(o.value)} onClick={() => toggleMulti("driveStyle", o.value)} />
            ))}
          </div>
          <Nav canNext={answers.driveStyle.length > 0} />
        </>);

      case "cabin":
        return (<>
          <SectionTag label="The Feel" />
          <Title>When you're inside the car, what matters most?</Title>
          <Subtitle>Tap everything that resonates — pick as many as you like.</Subtitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { value: "Quiet cabin — I want my own bubble, sealed from the world", icon: "🫧" },
              { value: "Premium materials — real leather, real wood, things that feel good to touch", icon: "🤌" },
              { value: "Great sound system — music is a big part of the drive for me", icon: "🎵" },
              { value: "Perfect seats — I want to sit in this car for hours and feel great", icon: "💆" },
              { value: "Big windows & visibility — I want to see everything around me", icon: "🪟" },
              { value: "Simple controls — physical buttons, intuitive layout, not a tablet on wheels", icon: "🎛️" },
              { value: "Tech-forward — big screen, latest features, voice control, I love it", icon: "📱" },
              { value: "A special smell — new leather, quality materials, it hits different", icon: "👃" },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon}
                selected={answers.cabinPriorities.includes(o.value)}
                onClick={() => toggleMulti("cabinPriorities", o.value)} />
            ))}
          </div>
          <Nav canNext={true} />
        </>);

      case "hidden":
        return (<>
          <SectionTag label="The Stuff People Miss" />
          <Title>A few things people wish they'd thought about.</Title>
          <Subtitle>These are the little things that shape how you feel about a car a couple years in. Tap any that ring true — or skip if none do.</Subtitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { value: "Reliability is critical — I don't want surprises at the mechanic", icon: "🛡️",
                desc: "Some beautiful cars have expensive known problems. We'll steer you clear." },
              { value: "I hate complicated tech — if the screen is glitchy or confusing, I'll resent the car", icon: "😤",
                desc: "This is the #1 regret factor in new car purchases right now." },
              { value: "Maintenance costs matter — I need to know what I'm signing up for", icon: "🔧",
                desc: "A $50K BMW can cost twice as much to maintain as a $50K Lexus." },
              { value: "I want a car that holds its value — resale matters to me", icon: "📈",
                desc: "Some cars lose 50% in 3 years. Others barely depreciate." },
              { value: "I want something unique — I don't want to see my car everywhere", icon: "💎",
                desc: "We'll find something with character, not just another crossover." },
              { value: "I care about fuel costs — efficiency is practical, not boring", icon: "⛽",
                desc: "Hybrids and efficient engines can save thousands per year." },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon} desc={o.desc}
                selected={answers.hiddenFactors.includes(o.value)}
                onClick={() => toggleMulti("hiddenFactors", o.value)} />
            ))}
          </div>

          <div style={{ marginTop: 24, marginBottom: 4 }}>
            <div style={{ fontSize: 13, color: "rgba(237,232,220,0.5)", marginBottom: 12,
              fontFamily: "'DM Sans', sans-serif" }}>And how do you like your car tech?</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { value: "Keep it simple — buttons, knobs, minimal screens", icon: "📻" },
                { value: "Modern but intuitive — nice tech that actually works well", icon: "👌" },
                { value: "Give me everything — latest tech, biggest screens, all the features", icon: "🚀" },
              ].map((o) => (
                <Pill key={o.value} label={o.value} icon={o.icon}
                  selected={answers.techComfort === o.value}
                  onClick={() => update("techComfort", o.value)} />
              ))}
            </div>
          </div>
          <Nav canNext={true} />
        </>);

      case "lifeFit":
        return (<>
          <SectionTag label="Life Fit" />
          <Title>Let's make sure it fits your actual life.</Title>
          <Subtitle>Quick practical stuff — tap whatever applies (more than one is fine).</Subtitle>

          <div style={{ fontSize: 13, color: "rgba(237,232,220,0.5)", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>How many people do you usually carry?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {[
              { value: "Just me most of the time", icon: "🧍" },
              { value: "Me and one other person", icon: "👥" },
              { value: "Family of 3-4", icon: "👨‍👩‍👧" },
              { value: "5+ people regularly", icon: "👨‍👩‍👧‍👦" },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon}
                selected={answers.passengers.includes(o.value)} onClick={() => toggleMulti("passengers", o.value)} />
            ))}
          </div>

          <div style={{ fontSize: 13, color: "rgba(237,232,220,0.5)", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>What will you mostly use it for?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {[
              { value: "Daily commute", icon: "🏢" },
              { value: "A long highway commute", icon: "🛤️" },
              { value: "Weekend adventures & road trips", icon: "🛣️" },
              { value: "Around town & errands", icon: "🏘️" },
              { value: "I work out of my vehicle", icon: "🧰" },
              { value: "Rideshare / delivery driving", icon: "🚕" },
              { value: "A bit of everything", icon: "🔄" },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon}
                selected={answers.primaryUse.includes(o.value)} onClick={() => toggleMulti("primaryUse", o.value)} />
            ))}
          </div>

          <div style={{ fontSize: 13, color: "rgba(237,232,220,0.5)", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>Cargo needs?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { value: "Minimal — a trunk is fine", icon: "🎒" },
              { value: "Moderate — groceries, gear, stroller", icon: "🧳" },
              { value: "Serious — sports equipment, large items, hauling", icon: "📦" },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon}
                selected={answers.cargoNeeds === o.value} onClick={() => update("cargoNeeds", o.value)} />
            ))}
          </div>
          <Nav canNext={true} />
        </>);

      case "dealbreakers":
        return (<>
          <SectionTag label="Life Fit" />
          <Title>Any absolute dealbreakers?</Title>
          <Subtitle>Most people skip this — but if there's something you flat-out need (or won't accept), tap it. Otherwise just hit Continue.</Subtitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { value: "Must be a truck / pickup", icon: "🛻" },
              { value: "Must be an SUV / crossover", icon: "🚙" },
              { value: "No SUVs or trucks — just a car", icon: "🚗" },
              { value: "Manual transmission", icon: "🕹️" },
              { value: "All-wheel / 4-wheel drive", icon: "❄️" },
              { value: "Must be a convertible", icon: "🌤️" },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon}
                selected={answers.dealbreakers.includes(o.value)}
                onClick={() => toggleMulti("dealbreakers", o.value)} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: "rgba(237,232,220,0.3)", marginTop: 14,
            fontFamily: "'DM Sans', sans-serif", fontStyle: "italic", lineHeight: 1.5 }}>
            Heads up: manuals are rare these days, so picking "manual" narrows things a lot — we'll favor the cars that still offer one rather than hide everything else.
          </div>
          <Nav canNext={true} />
        </>);

      case "financial":
        return (<>
          <SectionTag label="Smart Money" />
          <Title>Let's talk about what makes sense financially.</Title>
          <Subtitle>Whether it's $300 a month or $2,000, there's a great car waiting. We'll match to what feels comfortable — not stretch you past it.</Subtitle>

          {/* How are you paying? This changes what a budget actually buys. */}
          <div style={{ fontSize: 13, color: "rgba(237,232,220,0.5)", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>How are you planning to pay?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {[
              { value: "finance", label: "Finance it — monthly payment", icon: "🏦" },
              { value: "lease", label: "Lease it — monthly payment", icon: "🔁" },
              { value: "cash", label: "Pay cash — total price", icon: "💵" },
            ].map((o) => (
              <Pill key={o.value} label={o.label} icon={o.icon}
                selected={answers.paymentMethod === o.value} onClick={() => update("paymentMethod", o.value)} />
            ))}
          </div>

          <button onClick={() => setShowPayInfo(v => !v)} style={{
            marginTop: 2, marginBottom: 18, background: "none", border: "none", color: "#cfaa5a", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, fontWeight: 600, padding: "4px 0",
            display: "flex", alignItems: "center", gap: 6,
          }}>{showPayInfo ? "▾" : "▸"} Not sure which is right? See the pros & cons</button>

          {showPayInfo && (
            <div style={{ marginBottom: 22, padding: "16px 18px", background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, fontFamily: "'DM Sans', sans-serif",
              fontSize: 13.5, lineHeight: 1.65, color: "rgba(237,232,220,0.7)" }}>
              <div style={{ marginBottom: 12 }}>
                <strong style={{ color: "#cfaa5a" }}>🏦 Finance (loan)</strong><br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Pros:</span> You own it at the end and build equity; no mileage limits; sell or modify whenever you want.<br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Cons:</span> Higher monthly payment than leasing; you absorb the depreciation; longer loans pile on interest.
              </div>
              <div style={{ marginBottom: 12 }}>
                <strong style={{ color: "#cfaa5a" }}>🔁 Lease</strong><br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Pros:</span> Lower payment for the same car; always under warranty; easy to step into a newer car every few years.<br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Cons:</span> You never own it; mileage caps with overage fees; wear charges; payments never end if you keep leasing; costly to exit early.
              </div>
              <div>
                <strong style={{ color: "#cfaa5a" }}>💵 Cash</strong><br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Pros:</span> No interest and no monthly payment; you own it outright; strongest negotiating position, especially on used cars.<br/>
                <span style={{ color: "rgba(237,232,220,0.5)" }}>Cons:</span> Ties up a big chunk of cash at once — money that can't be invested or kept as a cushion.
              </div>
            </div>
          )}

          {answers.paymentMethod !== "cash" && (<>
            <div style={{ fontSize: 13, color: "rgba(237,232,220,0.5)", marginBottom: 10,
              fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
              What's a comfortable {answers.paymentMethod === "lease" ? "monthly lease payment" : "monthly payment"}?
            </div>
            <div style={{ fontSize: 12, color: "rgba(237,232,220,0.35)", marginBottom: 14,
              fontFamily: "'DM Sans', sans-serif", fontStyle: "italic" }}>
              {answers.paymentMethod === "lease"
                ? "Leasing stretches a monthly budget further, so we'll open up some pricier cars to match."
                : "Think total: payment + insurance + gas + maintenance. Not just the payment."}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
              {[
                { value: "Under $400/month — and that's totally fine, there are gems here", icon: "💚" },
                { value: "$400 – $700/month — the sweet spot for amazing used and solid new", icon: "💛" },
                { value: "$700 – $1,200/month — opens up a lot of great options", icon: "🔶" },
                { value: "$1,200 – $2,000/month — premium territory", icon: "⭐" },
                { value: "$2,000+/month — no limits", icon: "💎" },
              ].map((o) => (
                <Pill key={o.value} label={o.value} icon={o.icon}
                  selected={answers.monthlyBudget === o.value} onClick={() => update("monthlyBudget", o.value)} />
              ))}
            </div>
          </>)}

          {answers.paymentMethod === "cash" && (<>
            <div style={{ fontSize: 13, color: "rgba(237,232,220,0.5)", marginBottom: 10,
              fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>What total are you comfortable spending?</div>
            <div style={{ fontSize: 12, color: "rgba(237,232,220,0.35)", marginBottom: 14,
              fontFamily: "'DM Sans', sans-serif", fontStyle: "italic" }}>
              The all-in price you'd pay — paying cash is especially powerful in the used market.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
              {[
                { value: "Under $15k — there are real gems down here", icon: "💚" },
                { value: "$15k – $30k — huge sweet spot for used", icon: "💛" },
                { value: "$30k – $60k — lots of great options", icon: "🔶" },
                { value: "$60k – $100k — premium territory", icon: "⭐" },
                { value: "$100k+ — no limits", icon: "💎" },
              ].map((o) => (
                <Pill key={o.value} label={o.value} icon={o.icon}
                  selected={answers.cashBudget === o.value} onClick={() => update("cashBudget", o.value)} />
              ))}
            </div>
          </>)}

          <div style={{ fontSize: 13, color: "rgba(237,232,220,0.5)", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>Are you open to a used car?</div>
          <div style={{ padding: "14px 16px", background: "rgba(207,170,90,0.06)",
            border: "1px solid rgba(207,170,90,0.12)", borderRadius: 12, marginBottom: 14,
            fontSize: 13, color: "rgba(237,232,220,0.5)", lineHeight: 1.55,
            fontFamily: "'DM Sans', sans-serif" }}>
            💡 A quick thought: a 3-year-old car with 30K miles has already taken its biggest depreciation hit — someone else paid for that. You can often get a $60K car for $35K, and it drives exactly the same. Some of the most beloved cars ever made are 5–15 years old.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { value: "Absolutely — show me the best car for the money, new or used", icon: "✅" },
              { value: "Maybe — if it's the right car with low miles and good history", icon: "🤔" },
              { value: "I prefer new — warranty and peace of mind matter to me", icon: "🆕" },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon}
                selected={answers.openToUsed === o.value} onClick={() => update("openToUsed", o.value)} />
            ))}
          </div>

          {/* Warranty learn-more */}
          <button onClick={() => setShowWarranty(v => !v)} style={{
            marginTop: 14, width: "100%", padding: "13px 16px", borderRadius: 12,
            background: "rgba(120,180,220,0.06)", border: "1px solid rgba(120,180,220,0.18)",
            color: "rgba(150,200,240,0.85)", cursor: "pointer", textAlign: "left",
            fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, fontWeight: 600,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>🛡️ Worried about used cars? Here's how warranties work</span>
            <span style={{ transform: showWarranty ? "rotate(180deg)" : "none", transition: "transform 0.3s", fontSize: 12 }}>▾</span>
          </button>
          {showWarranty && (
            <div style={{ marginTop: 8, padding: "16px 18px", background: "rgba(120,180,220,0.04)",
              border: "1px solid rgba(120,180,220,0.12)", borderRadius: 12,
              fontSize: 13.5, color: "rgba(237,232,220,0.6)", lineHeight: 1.65,
              fontFamily: "'DM Sans', sans-serif", animation: "fadeUp 0.4s ease both" }}>
              <p style={{ marginBottom: 12 }}>
                <strong style={{ color: "rgba(150,200,240,0.85)" }}>Certified Pre-Owned (CPO):</strong> A used car the manufacturer has inspected, refurbished, and re-warrantied. It costs a bit more than a regular used car, but you get a manufacturer-backed warranty — often extending coverage to 6 years / 100K miles total. This is the easiest way to get new-car peace of mind at a used-car price.
              </p>
              <p style={{ marginBottom: 12 }}>
                <strong style={{ color: "rgba(150,200,240,0.85)" }}>Extended warranties:</strong> Even on a non-CPO used car, you can buy a separate service contract that covers major repairs. These typically run roughly $1,000–$3,000 for several years of coverage. Buy from the manufacturer or a reputable provider — and feel free to decline high-pressure dealer add-ons.
              </p>
              <p style={{ margin: 0, fontStyle: "italic", color: "rgba(237,232,220,0.5)" }}>
                Bottom line: a used car with a warranty can give you the same "I won't get a surprise bill" confidence as new — for thousands less.
              </p>
            </div>
          )}

          <Nav canNext={true} />
        </>);

      case "ownership":
        return (<>
          <SectionTag label="Smart Money" />
          <Title>Last one — how long do you see yourself keeping it?</Title>
          <Subtitle>This nudges the picks a bit. A keep-forever car and a trade-in-after-3 car aren't always the same car.</Subtitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { value: "1-2 years — I like to switch it up", icon: "🔄" },
              { value: "3-4 years — a good run then move on", icon: "📅" },
              { value: "5-7 years — I want to get my money's worth", icon: "🤝" },
              { value: "As long as it runs — I drive them into the ground", icon: "♾️" },
            ].map((o) => (
              <Pill key={o.value} label={o.value} icon={o.icon}
                selected={answers.ownershipLength === o.value} onClick={() => update("ownershipLength", o.value)} />
            ))}
          </div>
          <Nav canNext={true} nextLabel="Find My Cars" onNext={getRecommendations} />
        </>);

      case "loading":
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", minHeight: "70vh", textAlign: "center" }}>
            {!error && <>
              <div className="spinner" />
              <div style={{ fontSize: 22, fontFamily: "'Instrument Serif', serif", marginTop: 32,
                color: "#ede8dc", marginBottom: 10 }}>Finding your perfect cars...</div>
              <div style={{ fontSize: 14, color: "rgba(237,232,220,0.4)",
                fontFamily: "'DM Sans', sans-serif", maxWidth: 320, lineHeight: 1.5 }}>
                We're analyzing your preferences against thousands of cars — new and used, across every segment and era — to find the three that were made for you.
              </div>
            </>}
            {error && (
              <div style={{ padding: "20px 24px", background: "rgba(220,80,80,0.08)",
                border: "1px solid rgba(220,80,80,0.25)", borderRadius: 16, maxWidth: 360 }}>
                <div style={{ fontSize: 30, marginBottom: 12 }}>🔧</div>
                <div style={{ fontSize: 15, color: "rgba(237,232,220,0.7)", fontFamily: "'DM Sans', sans-serif",
                  lineHeight: 1.5, marginBottom: 18 }}>{error}</div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button onClick={() => { setError(null); setStep(ownershipStepIdx); }} style={{ padding: "11px 22px",
                    borderRadius: 50, background: "transparent", border: "1px solid rgba(255,255,255,0.12)",
                    color: "rgba(237,232,220,0.6)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600,
                  }}>Go Back</button>
                  <button onClick={getRecommendations} style={{ padding: "11px 26px",
                    borderRadius: 50, background: "linear-gradient(135deg, #cfaa5a, #b8923e)", border: "none",
                    color: "#1b1915", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600,
                  }}>Try Again</button>
                </div>
              </div>
            )}
            <style>{`
              .spinner { width: 44px; height: 44px; border: 3px solid rgba(207,170,90,0.15);
                border-top-color: #cfaa5a; border-radius: 50%;
                animation: spin 0.9s linear infinite; }
              @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
          </div>
        );

      case "results":
        if (!results) return null;
        const leanOptions = [
          { kind: "sport", label: "More driver-focused", icon: "🏎️" },
          { kind: "comfort", label: "More comfort & calm", icon: "☁️" },
          { kind: "luxury", label: "More luxury", icon: "👑" },
          { kind: "practical", label: "More practical & reliable", icon: "🛡️" },
          { kind: "budgetUp", label: "Show me a higher budget", icon: "⬆️" },
        ];
        return (<>
          {zeroInCar && <ZeroIn car={zeroInCar} answers={answers} onBack={() => setZeroInCar(null)} onNavigate={onNavigate} />}
          {!zeroInCar && (<>
          <div style={{ textAlign: "center", marginBottom: 36, paddingTop: 10 }}>
            <SectionTag label="YOUR MATCHES" />
            <Title>We found your cars.</Title>
            <p style={{ fontSize: 14, color: "rgba(237,232,220,0.45)", lineHeight: 1.6,
              fontFamily: "'DM Sans', sans-serif", maxWidth: 420, margin: "0 auto" }}>
              {results.philosophy}
            </p>
          </div>

          {results.cars.map((car, i) => <CarCard key={car._key} car={car} rank={i} />)}

          {results.more && results.more.length > 0 && (
            <div style={{ marginTop: 30 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, fontWeight: 700, color: "rgba(237,232,220,0.4)",
                fontFamily: "'DM Sans', sans-serif", marginBottom: 12 }}>A FEW MORE THAT FIT</div>
              {results.more.map((car) => (
                <MoreRow key={car._key} car={car} finance={answers.paymentMethod === "finance"} />
              ))}
            </div>
          )}

          {/* Explore more */}
          <div style={{ marginTop: 32, marginBottom: 8, padding: "22px 20px",
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16 }}>
            <div style={{ fontSize: 16, fontFamily: "'Instrument Serif', serif", color: "#ede8dc",
              marginBottom: 4, textAlign: "center" }}>Want to explore in a direction?</div>
            <div style={{ fontSize: 13, color: "rgba(237,232,220,0.45)", fontFamily: "'DM Sans', sans-serif",
              textAlign: "center", marginBottom: 18, lineHeight: 1.5 }}>
              Tap any lean and we'll pull three more cars that nudge that way — no repeats.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {leanOptions.map(opt => (
                <button key={opt.kind} disabled={loadingMore !== null}
                  onClick={() => showMore(opt.kind)} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", borderRadius: 50,
                    background: loadingMore === opt.kind ? "rgba(207,170,90,0.25)" : "rgba(207,170,90,0.1)",
                    border: "1px solid rgba(207,170,90,0.3)", color: "#cfaa5a",
                    cursor: loadingMore !== null ? "default" : "pointer", opacity: loadingMore !== null && loadingMore !== opt.kind ? 0.4 : 1,
                    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600,
                    transition: "all 0.2s ease",
                  }}>
                  <span style={{ fontSize: 15 }}>{opt.icon}</span>
                  {loadingMore === opt.kind ? "Finding…" : opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Extra leaned batches */}
          {extraBatches.map((batch, bi) => (
            <div key={bi} style={{ marginTop: 28 }}>
              <div style={{ fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 700,
                letterSpacing: "0.15em", textTransform: "uppercase", color: "#cfaa5a",
                marginBottom: 16, textAlign: "center" }}>
                {batch.label}
              </div>
              {batch.cars.map((car) => <CarCard key={car._key} car={car} />)}
            </div>
          ))}

          <div style={{ textAlign: "center", marginTop: 28, paddingBottom: 40 }}>
            <button onClick={() => { setStep(0); setExtraBatches([]); setLoadingMore(null);
              setAnswers({ lovedCars: [], currentCarInput: "", currentLoveInput: [], currentLoveText: "", powertrain: [],
              vibe: [], driveStyle: [], cabinPriorities: [], hiddenFactors: [], passengers: [],
              primaryUse: [], dealbreakers: [], cargoNeeds: null, paymentMethod: "finance", monthlyBudget: null, cashBudget: null, openToUsed: null, ownershipLength: null,
              techComfort: null }); setResults(null); }} style={{
              padding: "14px 32px", borderRadius: 50, background: "transparent",
              border: "1.5px solid rgba(207,170,90,0.25)", color: "#cfaa5a", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600 }}>Start Over</button>
          </div>

          <style>{`
            @keyframes fadeUp {
              from { opacity: 0; transform: translateY(24px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
          </>)}
        </>);

      default:
        return null;
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#1b1915", color: "#ede8dc", position: "relative", overflow: "hidden" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />

      {/* Ambient glow */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-40%", right: "-30%", width: "80vw", height: "80vw",
          background: "radial-gradient(circle, rgba(207,170,90,0.03) 0%, transparent 65%)", borderRadius: "50%" }} />
      </div>

      <div ref={containerRef} style={{ position: "relative", zIndex: 1, maxWidth: 540,
        margin: "0 auto", padding: "36px 20px", minHeight: "100vh" }}>

        {onHome && !zeroInCar && (
          <button onClick={onHome} style={{ background: "none", border: "none", color: "rgba(207,170,90,0.75)",
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, fontWeight: 600,
            padding: "2px 0", marginBottom: 16 }}>‹ Home</button>
        )}

        {/* Progress bar */}
        {!zeroInCar && currentStep.phase !== "intro" && currentStep.id !== "loading" && (
          <div style={{ display: "flex", gap: 4, marginBottom: 28 }}>
            {Object.keys(PHASE_LABELS).map((phase, i) => (
              <div key={phase} style={{ flex: 1, height: 2.5, borderRadius: 2,
                background: i <= phaseIdx ? "#cfaa5a" : "rgba(255,255,255,0.07)",
                transition: "background 0.5s ease" }} />
            ))}
          </div>
        )}

        <div key={step} style={{ animation: "contentIn 0.45s ease" }}>
          {renderStep()}
        </div>
        <style>{`
          * { box-sizing: border-box; }
          @keyframes contentIn {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  HOME — the single front door to the whole car journey
// ─────────────────────────────────────────────────────────────

function PathwayCard({ eyebrow, title, body, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: "block", width: "100%", textAlign: "left", cursor: "pointer",
        background: hover ? "rgba(207,170,90,0.07)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${hover ? "rgba(207,170,90,0.45)" : C.line}`,
        borderLeft: `3px solid ${C.gold}`, borderRadius: 16, padding: "20px 20px", marginBottom: 14,
        color: C.text, fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s ease",
      }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
        <span style={{ fontSize: 11.5, letterSpacing: 1.5, fontWeight: 700, color: C.gold }}>{eyebrow}</span>
        <span style={{ color: C.gold, fontSize: 20, transform: hover ? "translateX(3px)" : "none", transition: "transform 0.2s ease" }}>→</span>
      </div>
      <div style={{ fontFamily: "'Instrument Serif', serif", fontSize: 27, lineHeight: 1.05, marginBottom: 7 }}>{title}</div>
      <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.5 }}>{body}</div>
    </button>
  );
}

function SoonCard({ title, body }) {
  return (
    <div style={{ flex: 1, background: "rgba(255,255,255,0.02)", border: `1px dashed ${C.line}`,
      borderRadius: 14, padding: "14px 14px" }}>
      <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, fontWeight: 700, color: C.dim, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.4 }}>{body}</div>
    </div>
  );
}

function Home({ go }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans', sans-serif",
      padding: "44px 20px 56px", maxWidth: 560, margin: "0 auto" }}>
      <style>{`*{box-sizing:border-box;}`}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 30 }}>
        <span style={{ fontSize: 24, color: C.gold, lineHeight: 1 }}>♞</span>
        <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 25, color: C.text, letterSpacing: 0.3 }}>Garage Knight</span>
      </div>
      <div style={{ letterSpacing: 2.5, fontSize: 11, fontWeight: 700, color: C.gold, marginBottom: 14 }}>ON YOUR SIDE — NOT THE DEALER'S</div>
      <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 48, lineHeight: 1.0, margin: "0 0 14px" }}>Your car champion,<br />for life.</h1>
      <p style={{ color: C.dim, fontSize: 15.5, lineHeight: 1.55, margin: "0 0 34px" }}>
        Find the right car, dodge the dealership traps, and keep it running — with someone in your corner the whole way.
      </p>

      <PathwayCard eyebrow="FIND YOUR CAR" title="What should I actually buy?"
        body="Answer a few feel-based questions and get honest matches — new or used — with the catches spelled out."
        onClick={() => go("matchmaker")} />

      <PathwayCard eyebrow="AT THE DEALERSHIP" title="Is this offer a rip-off?"
        body="Paste the dealer's numbers before you sign. We flag the traps and show what you're really paying."
        onClick={() => go("decoder")} />

      <PathwayCard eyebrow="IN THE GARAGE" title="Is this repair worth it?"
        body="Got a repair quote? See whether it's worth doing — and how to avoid overpaying at the shop."
        onClick={() => go("repair")} />

      <div style={{ marginTop: 28, marginBottom: 12, fontSize: 11, letterSpacing: 2, fontWeight: 700, color: C.faint }}>COMING SOON</div>
      <div style={{ display: "flex", gap: 12 }}>
        <SoonCard title="Your Garage" body="Track service & remember what's due." />
        <SoonCard title="Sell or Keep?" body="Is it time to move on from your car?" />
      </div>

      <div style={{ marginTop: 34, fontSize: 12, color: C.faint, textAlign: "center", lineHeight: 1.5 }}>
        No dealers pay us. No ads. Just honest help.
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("home");
  if (view === "matchmaker") return <CarMatchmaker onHome={() => setView("home")} onNavigate={setView} />;
  if (view === "decoder") return <DealDecoder onHome={() => setView("home")} />;
  if (view === "repair") return <RepairCheck onHome={() => setView("home")} />;
  return <Home go={setView} />;
}
