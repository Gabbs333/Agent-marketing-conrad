"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateLandingCopy = generateLandingCopy;
exports.renderLandingPage = renderLandingPage;
const config_1 = require("../config");
const textGenerator_1 = require("../content/textGenerator");
async function generateLandingCopy(campaignName) {
    const raw = await (0, textGenerator_1.generatePostText)({ platform: "web", topic: campaignName });
    try {
        const parsed = JSON.parse(raw);
        if (parsed.headline && Array.isArray(parsed.benefits))
            return parsed;
    }
    catch {
        /* on utilise le fallback ci-dessous */
    }
    return {
        headline: campaignName,
        subheadline: config_1.config.hotel.tagline,
        benefits: [
            "Chambres élégantes et confortables",
            "Petit-déjeuner gastronomique inclus",
            "Annulation flexible",
        ],
    };
}
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function renderLandingPage(input) {
    const { campaignId, name, copy } = input;
    const hotel = config_1.config.hotel.name;
    const cid = escapeHtml(campaignId);
    const cname = escapeHtml(name);
    const headline = escapeHtml(copy.headline);
    const subheadline = escapeHtml(copy.subheadline);
    const benefits = copy.benefits
        .map((b) => `<li>${escapeHtml(b)}</li>`)
        .join("\n");
    return `<!DOCTYPE html>
<html lang="${config_1.config.contentLanguage}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${cname} — ${escapeHtml(hotel)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; color: #E8E3D8; background: #070F1C; min-height: 100vh; }
  .hero { padding: 110px 24px 70px; text-align: center; background:
    radial-gradient(1100px 500px at 50% -10%, #12233D 0%, transparent 60%),
    linear-gradient(165deg, #070F1C 0%, #0B1626 55%, #12233D 100%); }
  .hero .kicker { font-size: .74rem; letter-spacing: .3em; text-transform: uppercase; color: #C9A25E; margin-bottom: 18px; }
  .hero h1 { font-family: 'Playfair Display', Georgia, serif; font-size: 2.9rem; font-weight: 600; color: #EAD9AE; margin-bottom: 18px; max-width: 720px; margin-left:auto; margin-right:auto; line-height:1.15; }
  .hero p { font-size: 1.1rem; color: #9FB0C8; max-width: 560px; margin: 0 auto; }
  .benefits { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; padding: 48px 24px 20px; max-width: 940px; margin: 0 auto; }
  .benefits li { list-style: none; background: #FFFFFF0A; border: 1px solid #FFFFFF1A; backdrop-filter: blur(6px); border-radius: 14px; padding: 20px 24px; flex: 1 1 230px; text-align: center; color: #E8E3D8; font-size:.95rem; transition: transform .18s, border-color .18s; }
  .benefits li:hover { transform: translateY(-3px); border-color: #C9A25E66; }
  .card { max-width: 470px; margin: 12px auto 90px; padding: 34px 36px; background: #FFFFFF; color: #0B1626; border-radius: 22px; box-shadow: 0 30px 80px #00000066; }
  .card h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 1.5rem; margin-bottom: 6px; }
  .card .sub { color:#8A93A3; font-size:.86rem; margin-bottom: 20px; }
  .card input { width: 100%; padding: 13px 15px; margin-bottom: 12px; border: 1.5px solid #E9E2D4; border-radius: 10px; font-size: 1rem; font-family: 'Inter', sans-serif; transition: border-color .15s, box-shadow .15s; }
  .card input:focus { outline:none; border-color: #C9A25E; box-shadow: 0 0 0 3px #C9A25E26; }
  .card button { width: 100%; padding: 15px; background: linear-gradient(135deg, #D9B36A, #C9A25E); color: #070F1C; border: none; border-radius: 10px; font-size: 1.02rem; font-weight: 700; cursor: pointer; box-shadow: 0 8px 22px #C9A25E40; transition: transform .15s, filter .15s; }
  .card button:hover { filter: brightness(1.06); transform: translateY(-1px); }
  #result { margin-top: 14px; text-align: center; font-weight: 600; min-height: 1.2em; font-size:.9rem; }
  footer { text-align: center; padding: 28px; color: #7E8BA0; font-size: .84rem; letter-spacing: .04em; }
</style>
</head>
<body>
  <section class="hero">
    <div class="kicker">${escapeHtml(hotel)}</div>
    <h1>${headline}</h1>
    <p>${subheadline}</p>
  </section>

  <ul class="benefits">${benefits}</ul>

  <section class="card">
    <h2>Recevez nos meilleures offres</h2>
    <p class="sub">Réservation prioritaire, offres privées et annulation flexible.</p>
    <form id="lead-form">
      <input type="text" name="name" placeholder="Votre nom" />
      <input type="email" name="email" placeholder="Votre email" required />
      <input type="tel" name="phone" placeholder="Votre téléphone" />
      <button type="submit">Je veux en profiter</button>
      <p id="result"></p>
    </form>
  </section>

  <footer>${escapeHtml(hotel)} — ${escapeHtml(config_1.config.hotel.tagline)}</footer>

<script>
  (function () {
    var form = document.getElementById("lead-form");
    var result = document.getElementById("result");
    var params = new URLSearchParams(window.location.search);

    // Tracking de visite (pageview) rattaché à la campagne
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: "${cid}",
        event: "pageview",
        utm_source: params.get("utm_source") || null
      })
    }).catch(function () {});

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var payload = {
        campaignId: "${cid}",
        source: "landing_page",
        name: form.name.value || null,
        email: form.email.value || null,
        phone: form.phone.value || null,
        consent: true
      };
      fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
        .then(function (r) {
          if (r.ok) {
            result.style.color = "#15803d";
            result.textContent = "✅ Merci ! Nous vous recontactons très vite.";
            form.reset();
          } else {
            result.style.color = "#b91c1c";
            result.textContent = "Une erreur est survenue : " + (r.d.error || "réessayez");
          }
        })
        .catch(function () {
          result.style.color = "#b91c1c";
          result.textContent = "Erreur réseau, veuillez réessayer.";
        });
    });
  })();
</script>
</body>
</html>`;
}
//# sourceMappingURL=landingPage.js.map