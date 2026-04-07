// Cloudflare Pages Function: POST /api/subscribe
// Proxies subscription submissions to Beehiiv's REST API using a server-side API key.

const PUBLICATION_ID = "pub_a034c11f-fbe0-4b2a-aedd-9f40f22ac3f3";

export async function onRequestPost({ request, env }) {
  const headers = { "content-type": "application/json" };

  let email = "";
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await request.json();
      email = (body.email || "").trim();
    } else {
      const form = await request.formData();
      email = (form.get("email") || "").toString().trim();
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "bad_request" }), { status: 400, headers });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_email" }), { status: 400, headers });
  }

  if (!env.BEEHIIV_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "not_configured" }), { status: 500, headers });
  }

  const beehiivRes = await fetch(
    `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/subscriptions`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.BEEHIIV_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        reactivate_existing: false,
        send_welcome_email: true,
        utm_source: "caseymcdougal.dev",
        utm_medium: "organic",
        utm_campaign: "library",
        referring_site: "https://caseymcdougal.dev",
      }),
    }
  );

  if (!beehiivRes.ok) {
    const text = await beehiivRes.text();
    return new Response(
      JSON.stringify({ ok: false, error: "upstream", status: beehiivRes.status, detail: text.slice(0, 500) }),
      { status: 502, headers }
    );
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
