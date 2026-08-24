// Button-feedback audit — see the "Button feedback" section of
// docs/REQUIREMENTS.md for what this is enforcing and why.
//
// Reads only. Run from the repo root:  node scripts/audit-buttons.mjs
//
// The line that matters is the last one: a raw <button type="submit"> inside a
// <form action={...}> is a button that gives no sign it is working. It should be
// a <SubmitButton>. That count should stay at zero.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const files = execSync("git ls-files 'src/**/*.tsx'", { cwd: process.cwd() })
  .toString()
  .trim()
  .split("\n");

const buttons = [];
const forms = [];

/**
 * Blank out comments, keeping every byte position intact so reported line
 * numbers stay right. Without this, prose like "must be inside a `<form
 * action={...}>`" in a doc comment parses as a real form and every button under
 * it is misattributed — which is exactly what happened while building this.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
}

for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const src = stripComments(raw);
  const isClient = /^\s*["']use client["']/m.test(raw);

  // Walk tags in order, tracking which kind of form we are inside.
  const tagRe = /<(\/?)(form|button|SubmitButton)\b([^>]*?)(\/?)>/gs;
  const formStack = [];
  let m;
  while ((m = tagRe.exec(src))) {
    const [, closing, tag, attrs, selfClose] = m;
    const line = src.slice(0, m.index).split("\n").length;

    if (tag === "form") {
      if (closing) formStack.pop();
      else if (!selfClose) {
        const kind = /\baction=\{/.test(attrs)
          ? "action"
          : /method="get"/i.test(attrs)
            ? "get"
            : /\bonSubmit=/.test(attrs)
              ? "onSubmit"
              : "none";
        forms.push({ file: f, line, kind });
        formStack.push(kind);
      }
      continue;
    }
    if (closing) continue;

    const inForm = formStack[formStack.length - 1] ?? null;
    const type =
      tag === "SubmitButton"
        ? "submit"
        : /type="submit"/.test(attrs)
          ? "submit"
          : /type="(button|reset)"/.test(attrs) || /type=\{/.test(attrs)
            ? "other"
            : "none"; // no type inside a form means submit, per HTML

    buttons.push({
      file: f,
      line,
      tag,
      type,
      inForm,
      isClient,
      hasOnClick: /\bonClick=/.test(attrs),
      hasDisabled: /\bdisabled/.test(attrs),
      hasActive: /active:/.test(attrs),
    });
  }
}

const submits = buttons.filter((b) => b.type === "submit" || (b.type === "none" && b.inForm));
const feedbackReady = submits.filter((b) => b.tag === "SubmitButton");
const rawInActionForm = submits.filter((b) => b.tag === "button" && b.inForm === "action");
const otherSubmits = submits.filter((b) => b.tag === "button" && b.inForm !== "action");
const clickers = buttons.filter((b) => !submits.includes(b));

console.log(`files scanned                 ${files.length}`);
console.log(`clickable elements            ${buttons.length}`);
console.log(`  submit-ish                  ${submits.length}`);
console.log(`    <SubmitButton>            ${feedbackReady.length}  (pending + saved feedback)`);
console.log(`    raw, non-action form      ${otherSubmits.length}  (browser navigation — press state only)`);
console.log(`  non-submit (onClick etc.)   ${clickers.length}`);
// Not "async buttons" — this is every onClick button with no disabled binding.
// Most are instant local state (+ Add line, tab switches) and need nothing more
// than the press state. It is worth a look when it grows, because a button that
// awaits something and cannot disable itself is the dead-feeling case again.
console.log(
  `    …with no disabled binding   ${clickers.filter((b) => b.hasOnClick && !b.hasDisabled && b.isClient).length}  (fine if the handler is instant)`,
);
console.log(`<form>                        ${forms.length}`);
for (const k of ["action", "get", "onSubmit", "none"]) {
  console.log(`  ${k.padEnd(27)} ${forms.filter((f) => f.kind === k).length}`);
}

console.log(
  `\nraw <button type="submit"> inside a server-action form: ${rawInActionForm.length}` +
    (rawInActionForm.length === 0 ? "  ✓" : "  ← should be <SubmitButton>"),
);
for (const b of rawInActionForm) console.log(`  ${b.file}:${b.line}`);
process.exit(rawInActionForm.length === 0 ? 0 : 1);
