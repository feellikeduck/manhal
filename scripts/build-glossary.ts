// يحوّل data/glossary.json إلى ملف TypeScript يدخل في حزمة الـ Edge Function
// شغّله بعد أي تعديل على المسرد: deno task glossary
const src = new URL("../data/glossary.json", import.meta.url);
const out = new URL("../supabase/functions/manhal/lib/glossary-data.ts", import.meta.url);
const data = JSON.parse(await Deno.readTextFile(src));
await Deno.writeTextFile(
  out,
  `// مُولَّد من data/glossary.json — لا تعدّله يدوياً (deno task glossary)\nexport const GLOSSARY = ${
    JSON.stringify(data, null, 2)
  } as const;\n`,
);
console.log(`glossary: ${data.terms.length} terms → ${out.pathname}`);
