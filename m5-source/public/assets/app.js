(function () {
  async function shopifyToken() {
    try {
      if (window.shopify && typeof window.shopify.idToken === "function") {
        return await window.shopify.idToken();
      }
    } catch (_) {}
    return null;
  }

  async function ensureEmbeddedSession() {
    const token = await shopifyToken();
    if (!token) return;
    try {
      await fetch("/api/auth/session-token", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: "{}"
      });
    } catch (_) {}
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const token = await shopifyToken();
    if (!token) return originalFetch(input, init);
    const headers = new Headers((init && init.headers) || {});
    if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);
    return originalFetch(input, { ...(init || {}), headers });
  };

  document.addEventListener("submit", async function (event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.method && form.method.toLowerCase() === "get") return;
    const token = await shopifyToken();
    if (!token) return;
    // For classic form posts inside iframe, exchange session cookie first.
    event.preventDefault();
    await ensureEmbeddedSession();
    form.submit();
  }, true);

  function bindPreview() {
    const form = document.getElementById("article-form");
    const frame = document.getElementById("preview-frame");
    if (!form || !frame) return;

    function render() {
      const title = form.title?.value || "Untitled";
      const body = form.bodyHtml?.value || "";
      const excerpt = form.excerpt?.value || "";
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        body{font:16px/1.6 Georgia, serif;margin:0;padding:24px;color:#222;background:#fff}
        h1{font-size:1.8rem;line-height:1.2;margin:0 0 12px}
        .excerpt{color:#555;font-style:italic;margin-bottom:18px}
        img{max-width:100%}
      </style></head><body><h1>${escapeHtml(title)}</h1><p class="excerpt">${escapeHtml(excerpt)}</p>${body}</body></html>`;
      frame.srcdoc = html;
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    ["input", "change"].forEach(evt => form.addEventListener(evt, render));
    document.querySelectorAll("[data-preview]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-preview]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        frame.classList.toggle("mobile", btn.getAttribute("data-preview") === "mobile");
        frame.classList.toggle("desktop", btn.getAttribute("data-preview") === "desktop");
      });
    });
    render();
  }

  ensureEmbeddedSession().finally(bindPreview);
})();
