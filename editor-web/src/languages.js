// Code-block languages.
//
// Every language is imported statically. `@codemirror/language-data` resolves
// its grammars with dynamic `import()`, which webpack turns into separate
// chunks -- and a WKWebView loading the bundle from file:// cannot fetch them.

import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { r } from '@codemirror/legacy-modes/mode/r';

const stream = (mode) => StreamLanguage.define(mode);

const BY_NAME = {
  javascript: javascript().language,
  js: javascript().language,
  jsx: javascript({ jsx: true }).language,
  ts: javascript({ typescript: true }).language,
  tsx: javascript({ jsx: true, typescript: true }).language,
  typescript: javascript({ typescript: true }).language,
  python: python().language,
  py: python().language,
  html: html().language,
  htm: html().language,
  css: css().language,
  scss: css().language,
  less: css().language,
  json: json().language,
  rust: rust().language,
  rs: rust().language,
  go: go().language,
  golang: go().language,
  java: java().language,
  c: cpp().language,
  cpp: cpp().language,
  'c++': cpp().language,
  cc: cpp().language,
  h: cpp().language,
  php: php().language,
  sql: sql().language,
  xml: xml().language,
  svg: xml().language,
  yaml: yaml().language,
  yml: yaml().language,
  shell: stream(shell),
  bash: stream(shell),
  sh: stream(shell),
  zsh: stream(shell),
  swift: stream(swift),
  ruby: stream(ruby),
  rb: stream(ruby),
  lua: stream(lua),
  r: stream(r),
};

/**
 * Resolves a fence's info string to a Language.
 *
 * Must return a `Language`, not a `LanguageSupport` -- returning the latter
 * silently disables highlighting for that block.
 */
export function findLanguage(info) {
  if (!info) return null;
  const name = String(typeof info === 'string' ? info : info.name || '')
    .trim()
    .toLowerCase();
  return BY_NAME[name] || null;
}
