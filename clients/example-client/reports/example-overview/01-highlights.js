// Custom JS: anything the declarative bindings don't cover. VL.onData gives you
// the raw rows of any named query once it loads (and again after filter changes).
VL.onData("monthly", (rows) => {
  const el = document.getElementById("highlights");
  if (!el || !rows.length) return;
  const best = rows.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  el.innerHTML =
    'Best month: <span class="ex-best">' + best.month + "</span> at " + VL.format(best.revenue, "currency");
});
