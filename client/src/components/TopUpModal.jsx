import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api";

const PACKAGES = [
  { id: "mini", label: "Mini Top-Up", chips: 500, price: "$1.99" },
  { id: "starter", label: "Starter Stack", chips: 2000, price: "$4.99" },
  { id: "popular", label: "Popular Pack", chips: 10000, price: "$14.99", best: true },
  { id: "high_roller", label: "High Roller Pack", chips: 25000, price: "$29.99" },
  { id: "whale", label: "Whale Bundle", chips: 50000, price: "$49.99" },
  { id: "mega_whale", label: "Mega Whale", chips: 150000, price: "$99.99" },
];

export default function TopUpModal({ open, onClose, onCredited }) {
  const [step, setStep] = useState("pick"); // pick | card | processing | done
  const [selected, setSelected] = useState(null);
  const [card, setCard] = useState({ number: "", expiry: "", cvv: "", name: "" });
  const [credited, setCredited] = useState(0);

  if (!open) return null;

  function pick(pkg) {
    setSelected(pkg);
    setStep("card");
  }

  async function fakePay(e) {
    e.preventDefault();
    setStep("processing");
    // Purely cosmetic delay — no card data is ever sent anywhere, this is a
    // play-money game and nothing here touches a real payment processor.
    await new Promise((r) => setTimeout(r, 1400));
    try {
      const res = await api.post("/wallet/topup", { pkg: selected.id });
      onCredited(res.data.balance);
      setCredited(res.data.credited);
      setStep("done");
    } catch {
      setStep("card");
    }
  }

  function reset() {
    setStep("pick");
    setSelected(null);
    setCard({ number: "", expiry: "", cvv: "", name: "" });
    onClose();
  }

  return (
    <AnimatePresence>
      <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={reset}>
        <motion.div
          className="reveal-card"
          style={{ textAlign: "left" }}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          onClick={(e) => e.stopPropagation()}
        >
          {step === "pick" && (
            <>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>💰 Get More Chips</div>
              <p className="reveal-sub" style={{ marginBottom: 20 }}>
                100% play money — this is a fake checkout for the vibe, no real card is ever charged.
              </p>
              {PACKAGES.map((pkg) => (
                <button
                  key={pkg.id}
                  onClick={() => pick(pkg)}
                  className="btn btn-ghost"
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                    padding: "14px 16px",
                    borderColor: pkg.best ? "var(--gold)" : undefined,
                  }}
                >
                  <span>
                    <div style={{ fontWeight: 800 }}>
                      🪙 {pkg.chips.toLocaleString()} {pkg.best && <span style={{ color: "var(--gold-bright)" }}>★ BEST VALUE</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{pkg.label}</div>
                  </span>
                  <span style={{ fontWeight: 800, color: "var(--gold-bright)" }}>{pkg.price}</span>
                </button>
              ))}
              <button className="btn btn-ghost" style={{ width: "100%", marginTop: 6 }} onClick={reset}>
                Close
              </button>
            </>
          )}

          {step === "card" && (
            <form onSubmit={fakePay}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>💳 Fake Checkout</div>
              <p className="reveal-sub" style={{ marginBottom: 18 }}>
                {selected.label} — {selected.chips.toLocaleString()} chips for {selected.price}
              </p>
              <div className="field">
                <label>Card number</label>
                <input
                  required
                  placeholder="4242 4242 4242 4242"
                  value={card.number}
                  onChange={(e) => setCard({ ...card, number: e.target.value })}
                />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Expiry</label>
                  <input required placeholder="12/29" value={card.expiry} onChange={(e) => setCard({ ...card, expiry: e.target.value })} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>CVV</label>
                  <input required placeholder="123" value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>Name on card</label>
                <input required placeholder="Play Money" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} />
              </div>
              <button className="btn btn-primary" style={{ width: "100%", marginTop: 6 }}>
                Pay {selected.price} (not really)
              </button>
              <div className="disclaimer" style={{ marginTop: 12 }}>
                Fake form — nothing you type here is sent anywhere or stored. It just instantly credits play chips.
              </div>
            </form>
          )}

          {step === "processing" && (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
              <div style={{ fontWeight: 700 }}>Processing payment…</div>
            </div>
          )}

          {step === "done" && (
            <div style={{ textAlign: "center", padding: "10px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 6 }}>+{credited.toLocaleString()} chips added!</div>
              <p className="reveal-sub">Enjoy the table.</p>
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={reset}>
                Done
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
