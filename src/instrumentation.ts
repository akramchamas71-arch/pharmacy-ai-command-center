// Runs once when the Next.js server starts (Railway: a long-lived Node process).
// Starts the CareLink follow-up sweep: reminds pharmacies that have not answered a reservation request
// and tells the customer when a pharmacy still does not answer. Disable with CARELINK_SWEEP=off.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CARELINK_SWEEP === "off") return;
  const { sweepCarelinkInquiries } = await import("@/lib/carelink");
  const run = () => {
    sweepCarelinkInquiries()
      .then((r) => {
        if (r.reminded || r.gaveUp) console.log(`[carelink] sweep: reminded=${r.reminded} gaveUp=${r.gaveUp}`);
      })
      .catch((e) => console.error("[carelink] sweep failed", e));
  };
  setTimeout(run, 60 * 1000);
  const timer = setInterval(run, 5 * 60 * 1000);
  if (typeof timer === "object" && timer && "unref" in timer) (timer as { unref: () => void }).unref();
}
