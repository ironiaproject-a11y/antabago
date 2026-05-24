// Supabase Edge Function — ai-proxy
// A chave da IA fica aqui no servidor. O frontend nunca vê a chave.
// Deploy: Supabase Dashboard → Edge Functions → New Function → cole este código

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ─── CORS — permite chamadas do seu app ───────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*",   // troque "*" pelo seu domínio em produção
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  try {
    const body = await req.json();
    const { provider, messages, systemPrompt, intensity } = body;

    // ─── Groq ──────────────────────────────────────────────────────────────
    if (provider === "groq" || !provider) {
      const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
      if (!GROQ_KEY) throw new Error("GROQ_API_KEY não configurada");

      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.slice(-10),
          ],
          max_tokens: 150,
          temperature: 0.75,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Groq error ${resp.status}: ${err}`);
      }

      const data = await resp.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || "Estou aqui com você. 💙";
      return new Response(JSON.stringify({ reply }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ─── Gemini ────────────────────────────────────────────────────────────
    if (provider === "gemini") {
      const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
      if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY não configurada");

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { role: "user",  parts: [{ text: systemPrompt + "\n\nEntendido? Agora responda ao usuário seguindo as instruções acima." }] },
              { role: "model", parts: [{ text: "Entendido. Estou pronto para ajudar." }] },
              ...messages.map((m: { role: string; content: string }) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
              })),
            ],
            generationConfig: { maxOutputTokens: 150, temperature: 0.75 },
          }),
        }
      );

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Gemini error ${resp.status}: ${err}`);
      }

      const data = await resp.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Estou aqui com você. 💙";
      return new Response(JSON.stringify({ reply }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Provider desconhecido: ${provider}`);

  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
