// خادم OpenAI وهمي لاختبار المحرك كاملاً محلياً بدون تكلفة
// deno run -A tests/mock-openai.ts   (المنفذ 8787)
const fakeVec = (t: string) => Array.from({ length: 1536 }, (_, i) => Math.sin(t.length * (i + 1)));
const reply = (obj: unknown) => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(obj) } }] });

Deno.serve({ port: 8787 }, async (req) => {
  const body = await req.json();
  if (new URL(req.url).pathname.endsWith("/embeddings")) {
    return Response.json({ data: body.input.map((t: string, index: number) => ({ index, embedding: fakeVec(t) })) });
  }
  if (body.messages.length === 1) {
    return Response.json({ choices: [{ message: { role: "assistant", content: "نعم، هذا حديث صحيح." } }] });
  }
  const system: string = body.messages[0].content;
  const user = body.messages[1].content;
  let p: any = {};
  try {
    p = JSON.parse(user);
  } catch { /* plain text */ }
  const first = (p.sources ?? [])[0];
  const ph = first ? (first.type === "quran" ? `{{quran:${first.ref}}}` : `{{hadith:${first.ref}}}`) + ` [${first.sid}]` : "";

  if (system.startsWith("You are the router")) {
    const personal = /طلقت|زوجتي|حلفت|زواجي/.test(user);
    const disputed = /اختلاف|خلاف/.test(user);
    return Response.json(reply({
      level: personal ? "D" : disputed ? "C" : "A",
      lang: /[a-z]/i.test(user) && !/[\u0600-\u06FF]/.test(user) ? "en" : "ar",
      search_query: user.slice(0, 40),
      out_of_scope: /هل فلان كافر/.test(user),
      needs_clarification: /^وش حكمه/.test(user.trim()),
      clarifying_question: "وش المسألة اللي تقصدها بالضبط؟",
      hostile: /ليش دينكم/.test(user),
    }));
  }
  if (system.startsWith("Extract")) {
    const text = String(user).replace(/^.*?:\s*/s, "");
    const claims = /الله لا إله|بسم الله|الحمد لله رب/.test(text) ? [{ type: "quran", text }] : [{ type: "hadith", text }];
    return Response.json(reply({ claims }));
  }
  if (system.startsWith("You are Manhal Translate")) {
    const v = (p.identified_verses ?? []).map((x: any) => x.placeholder).join(" ");
    return Response.json(reply({ translation: `Dear brothers, Allah says: ${v}. Fear Allah and keep up the Salah.` }));
  }
  if (system.startsWith("You are Manhal Guard")) {
    return Response.json(
      reply({ verdict: "issue", issues: [{ type: "unsupported", detail: "mock" }], corrected_answer: `${ph}` }),
    );
  }
  if (system.startsWith("You are Manhal Generate")) {
    return Response.json(reply({ title: "مخطط", sections: [{ heading: "الدليل", points: [ph] }], abstain: false }));
  }
  // Ask — مرة نكتب حديثاً مكذوباً بأنفسنا لنختبر أن منهل يمسكه
  if (/اختبار-اقتباس/.test(user)) {
    return Response.json(
      reply({ answer: `قال النبي: «اطلبوا العلم ولو في الصين فإنه فريضة» ${first ? `[${first.sid}]` : ""}`, abstain: false }),
    );
  }
  return Response.json(reply({ answer: `الجواب: ${ph}`, abstain: false }));
});
