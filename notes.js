const STORAGE_KEY = 'browser_notes_content';
const ROWS_PER_PAGE = Number(getComputedStyle(document.documentElement).getPropertyValue('--sheet-rows'));
const CURSOR_KEYS = /^(Arrow|Home|End)/;
const WHITESPACE_CLASS = { ' ': 'space', '\t': 'tab', '\n': 'break' };
const LIST_START = /^([ \t]*)((?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]][ \t]+)?)?/;
const REST_OF_WORD = /(\S*)[ \t]?/y;
// Ends measured text: it keeps a final empty line without taking any room.
const ZERO_WIDTH_SPACE = '\u200B';

const textarea = document.querySelector('textarea');
const paper = textarea.parentElement;
const mirror = document.querySelector('.mirror');
const ruler = document.querySelector('.ruler');
const sheets = document.querySelector('article');
const counts = document.querySelector('footer');

const isReading = () => document.body.classList.contains('reading');
const lineHeightOf = (element) => parseFloat(getComputedStyle(element).lineHeight);
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const cursorPosition = () => (textarea.selectionDirection === 'backward' ? textarea.selectionStart : textarea.selectionEnd);
const lineStartBefore = (text, i) => (i ? text.lastIndexOf('\n', i - 1) + 1 : 0);
const lineEndAfter = (text, i) => (text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i));

function codePointCount(text) {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

function lineBreaksBefore(text, i) {
  let n = 0;
  for (let at = text.indexOf('\n'); at >= 0 && at < i; at = text.indexOf('\n', at + 1)) n++;
  return n;
}

function measuredHeight(text) {
  ruler.textContent = text;
  return ruler.offsetHeight;
}

const CHARACTER_SAMPLE = '0'.repeat(10);
let charactersPerRow = 62;

function measureCharactersPerRow() {
  ruler.textContent = CHARACTER_SAMPLE;
  const sample = document.createRange();
  sample.selectNodeContents(ruler);
  const characterWidth = sample.getBoundingClientRect().width / CHARACTER_SAMPLE.length;
  if (characterWidth) charactersPerRow = Math.floor(ruler.getBoundingClientRect().width / characterWidth);
}

// A word wraps as a whole, so measuring up to a point inside or before a word needs the rest of it.
// A word longer than a row breaks anywhere instead, so its rest doesn't matter.
function restOfWord(text, i) {
  REST_OF_WORD.lastIndex = i;
  const [rest, word] = REST_OF_WORD.exec(text);
  return word.length < charactersPerRow - 2 ? rest : '';
}

const mirrorEnd = mirror.appendChild(document.createTextNode(ZERO_WIDTH_SPACE));
let mirroredLines = [];

function whitespaceMark(char) {
  const mark = document.createElement('i');
  mark.className = WHITESPACE_CLASS[char];
  mark.textContent = char;
  return mark;
}

function mirrorLine(line, isLast) {
  const span = document.createElement('span');
  line.split(/([ \t])/).forEach((part, i) => {
    if (part) span.append(i % 2 ? whitespaceMark(part) : part);
  });
  if (!isLast) span.append(whitespaceMark('\n'));
  return span;
}

function updateMirror() {
  const lines = textarea.value.split('\n');
  let same = 0;
  while (same < lines.length && same < mirroredLines.length && lines[same] === mirroredLines[same]) same++;
  const start = Math.max(0, same - 1); // the line before a change gains or loses its line break
  let sameAtEnd = 0;
  while (sameAtEnd < lines.length - start && sameAtEnd < mirroredLines.length - start
    && lines[lines.length - 1 - sameAtEnd] === mirroredLines[mirroredLines.length - 1 - sameAtEnd]) sameAtEnd++;
  for (let i = start; i < mirroredLines.length - sameAtEnd; i++) mirror.children[start].remove();
  const fresh = lines.slice(start, lines.length - sameAtEnd).map((line, i) => mirrorLine(line, start + i === lines.length - 1));
  (mirror.children[start] ?? mirrorEnd).before(...fresh);
  mirroredLines = lines;
}

function highlightCursorLine() {
  const text = textarea.value;
  const cursor = cursorPosition();
  const lineHeight = lineHeightOf(textarea);
  const textTop = textarea.getBoundingClientRect().top;
  const start = lineStartBefore(text, cursor);
  const line = lineBreaksBefore(text, start);
  const previousBreak = line && mirror.children[line - 1].lastChild;
  const firstRow = line ? Math.round((previousBreak.getBoundingClientRect().top - textTop) / lineHeight) + 1 : 0;
  const rowsOf = (piece) => Math.round(measuredHeight(piece + ZERO_WIDTH_SPACE) / lineHeight);
  const cursorRow = firstRow + rowsOf(text.slice(start, cursor) + restOfWord(text, cursor)) - 1;
  paper.style.setProperty('--highlight-top', `${textTop + firstRow * lineHeight - paper.getBoundingClientRect().top}px`);
  paper.style.setProperty('--highlight-height', `${rowsOf(text.slice(start, lineEndAfter(text, cursor))) * lineHeight}px`);
  return [textTop + cursorRow * lineHeight, textTop + (cursorRow + 1) * lineHeight];
}

function keepCursorInView() {
  const [top, bottom] = highlightCursorLine();
  const lowest = innerHeight - parseFloat(getComputedStyle(paper).paddingBottom);
  if (bottom > lowest) scrollBy(0, bottom - lowest);
  else if (top < 0) scrollBy(0, top);
}

let totals = { characters: 0, words: 0 };

function countTotals() {
  const text = textarea.value;
  totals = { characters: codePointCount(text), words: text.match(/\S+/g)?.length ?? 0 };
}

function showCounts() {
  const text = textarea.value;
  const cursor = cursorPosition();
  const characters = plural(totals.characters, 'char');
  const selected = codePointCount(text.slice(textarea.selectionStart, textarea.selectionEnd));
  const column = codePointCount(text.slice(lineStartBefore(text, cursor), cursor)) + 1;
  counts.dataset.counts = [
    `Ln ${lineBreaksBefore(text, cursor) + 1}, Col ${column}`,
    selected ? `${selected.toLocaleString()} of ${characters}` : characters,
    plural(totals.words, 'word'),
  ].join('\n');
}

let pendingFrame = 0;
let textChanged = false;
let followCursor = false;

function updateAfterChanges() {
  pendingFrame = 0;
  if (textChanged) {
    updateMirror();
    countTotals();
  }
  showCounts();
  if (followCursor) keepCursorInView();
  else highlightCursorLine();
  textChanged = followCursor = false;
}

const scheduleUpdate = () => { pendingFrame ||= requestAnimationFrame(updateAfterChanges); };

function continueLine() {
  const text = textarea.value;
  const cursor = textarea.selectionStart;
  if (cursor !== textarea.selectionEnd) return false;
  const start = lineStartBefore(text, cursor);
  const [lineStart, indent, listMarker] = text.slice(start, cursor).match(LIST_START);
  if (!lineStart) return false;
  const isEmptyItem = listMarker && cursor - start === lineStart.length && !text.slice(cursor, lineEndAfter(text, cursor)).trim();
  if (isEmptyItem) {
    textarea.setSelectionRange(start, cursor);
    document.execCommand('delete');
  } else {
    const nextMarker = (listMarker ?? '').replace(/^\d+/, (n) => Number(n) + 1).replace(/\[[xX]]/, '[ ]');
    document.execCommand('insertText', false, '\n' + indent + nextMarker);
  }
  return true;
}

function alignSelectedLines(center) {
  const text = textarea.value;
  const { selectionStart, selectionEnd } = textarea;
  const from = lineStartBefore(text, selectionStart);
  const lastSelected = text[selectionEnd - 1] === '\n' && selectionEnd > from ? selectionEnd - 1 : selectionEnd;
  const to = lineEndAfter(text, lastSelected);
  const aligned = text.slice(from, to).split('\n').map((line) => {
    const words = line.trim();
    const indent = center ? Math.max(0, Math.floor((charactersPerRow - codePointCount(words)) / 2)) : 0;
    return words && ' '.repeat(indent) + words;
  }).join('\n');
  textarea.setSelectionRange(from, to);
  document.execCommand('insertText', false, aligned);
  textarea.setSelectionRange(from, from + aligned.length);
}

function turnPage(down, extendSelection) {
  const text = textarea.value;
  const lineHeight = lineHeightOf(textarea);
  const rows = Math.floor(innerHeight / lineHeight);
  const rowOf = (i) => Math.round(measuredHeight(text.slice(0, i) + restOfWord(text, i) + ZERO_WIDTH_SPACE) / lineHeight) - 1;
  const rowStart = (row) => {
    let low = 0, high = text.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rowOf(middle) < row) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const cursor = cursorPosition();
  const row = rowOf(cursor);
  const targetRow = Math.max(0, row + (down ? rows : -rows));
  const targetStart = rowStart(targetRow);
  const nextStart = rowStart(targetRow + 1);
  const targetEnd = rowOf(nextStart) > targetRow ? nextStart - 1 : nextStart;
  const sameColumn = targetStart + cursor - rowStart(row);
  const position = Math.min(sameColumn, targetEnd);
  const anchor = textarea.selectionDirection === 'backward' ? textarea.selectionEnd : textarea.selectionStart;
  if (extendSelection) {
    textarea.setSelectionRange(Math.min(anchor, position), Math.max(anchor, position), position < anchor ? 'backward' : 'forward');
  } else {
    textarea.setSelectionRange(position, position);
  }
  scrollBy(0, (down ? rows : -rows) * lineHeight);
}

function splitIntoPages(text, lineHeight) {
  const rowOf = (i) => Math.round(measuredHeight(text.slice(0, i + 1) + (/\S/.test(text[i]) ? restOfWord(text, i + 1) : '')) / lineHeight);
  const pages = [];
  for (let start = 0, lastRow = ROWS_PER_PAGE; start < text.length; lastRow += ROWS_PER_PAGE) {
    let low = start, high = text.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rowOf(middle) > lastRow) high = middle;
      else low = middle + 1;
    }
    pages.push(text.slice(start, low));
    start = low;
  }
  return pages.length ? pages : [''];
}

function sheetSpacing() {
  const [first, second] = sheets.children;
  const { top, height } = first.getBoundingClientRect();
  const pitch = second ? second.getBoundingClientRect().top - top : height;
  return { pitch, overhead: pitch - ROWS_PER_PAGE * lineHeightOf(first) };
}

let lastSwitch = null;

function showReading() {
  const lineHeight = lineHeightOf(textarea);
  const topLine = Math.max(0, Math.floor(-textarea.getBoundingClientRect().top / lineHeight));
  sheets.replaceChildren(...splitIntoPages(textarea.value, lineHeight).map((page) => {
    const sheet = document.createElement('section');
    sheet.textContent = page;
    return sheet;
  }));
  const writingScroll = scrollY;
  document.body.classList.add('reading');
  scrollTo(0, writingScroll + Math.floor(topLine / ROWS_PER_PAGE) * sheetSpacing().overhead);
  lastSwitch = { readingScroll: scrollY, writingScroll };
}

function showWriting() {
  const { pitch, overhead } = sheetSpacing();
  const topPage = Math.max(0, Math.floor(-sheets.getBoundingClientRect().top / pitch));
  const target = lastSwitch?.readingScroll === scrollY ? lastSwitch.writingScroll : scrollY - topPage * overhead;
  document.body.classList.remove('reading');
  textarea.focus({ preventScroll: true });
  scrollTo(0, target);
  highlightCursorLine();
}

function saveAsTextFile() {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([textarea.value], { type: 'text/plain;charset=utf-8' }));
  link.download = 'notes.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href));
}

// Replaces the note with a dropped text file's contents, typed the browser's way so Ctrl+Z undoes it.
async function restoreFromFile(file) {
  if (file.type && !file.type.startsWith('text/')) return;
  const text = await file.text();
  if (isReading()) showWriting();
  textarea.focus();
  textarea.select();
  document.execCommand('insertText', false, text);
}

try { textarea.value = localStorage.getItem(STORAGE_KEY) ?? ''; } catch {}
history.scrollRestoration = 'manual';
textarea.setSelectionRange(0, 0);
measureCharactersPerRow();
updateMirror();
countTotals();
showCounts();
highlightCursorLine();

document.fonts.ready.then(() => {
  measureCharactersPerRow();
  highlightCursorLine();
});
addEventListener('resize', highlightCursorLine);

// Firefox scrolls the textarea itself to show the cursor; the text must stay fixed to the paper.
textarea.addEventListener('scroll', () => { textarea.scrollTop = 0; });

textarea.addEventListener('input', () => {
  try { localStorage.setItem(STORAGE_KEY, textarea.value); } catch {}
  textChanged = followCursor = true;
  scheduleUpdate();
});

addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || (event.newValue ?? '') === textarea.value) return;
  const { selectionStart, selectionEnd } = textarea;
  textarea.value = event.newValue ?? '';
  textarea.setSelectionRange(Math.min(selectionStart, textarea.value.length), Math.min(selectionEnd, textarea.value.length));
  textChanged = true;
  scheduleUpdate();
});

let cursorKeyPressed = false;
document.addEventListener('selectionchange', () => {
  if (isReading()) return;
  followCursor ||= cursorKeyPressed;
  scheduleUpdate();
});
addEventListener('keyup', () => { cursorKeyPressed = false; });

addEventListener('dragover', (event) => event.preventDefault());
addEventListener('drop', (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  event.preventDefault();
  restoreFromFile(file);
});

function copyWithoutSheetBreaks(event) {
  if (!isReading() || !getSelection().rangeCount) return;
  const selected = getSelection().getRangeAt(0).cloneRange();
  const allSheets = document.createRange();
  allSheets.selectNodeContents(sheets);
  if (selected.compareBoundaryPoints(Range.START_TO_START, allSheets) < 0) selected.setStart(allSheets.startContainer, allSheets.startOffset);
  if (selected.compareBoundaryPoints(Range.END_TO_END, allSheets) > 0) selected.setEnd(allSheets.endContainer, allSheets.endOffset);
  event.clipboardData.setData('text/plain', selected.toString());
  event.preventDefault();
}

document.addEventListener('copy', copyWithoutSheetBreaks);

let printedFromWriting = false;
addEventListener('beforeprint', () => {
  printedFromWriting = !isReading();
  if (printedFromWriting) showReading();
});
addEventListener('afterprint', () => {
  if (printedFromWriting) showWriting();
});

addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
  const hasSelection = textarea.selectionStart !== textarea.selectionEnd;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveAsTextFile();
  } else if (event.key === 'PageDown' || event.key === 'PageUp') {
    event.preventDefault();
    const down = event.key === 'PageDown';
    if (isReading()) {
      scrollBy(0, down ? sheetSpacing().pitch : -sheetSpacing().pitch);
    } else {
      cursorKeyPressed = true;
      turnPage(down, event.shiftKey);
    }
  } else if (isReading()) {
    if (event.key === 'Escape') showWriting();
  } else if (event.key === 'Escape') {
    showReading();
  } else if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey && (plain || hasSelection)) {
    event.preventDefault();
    if (hasSelection) alignSelectedLines(!event.shiftKey);
    else document.execCommand('insertText', false, '\t'); // insertText keeps it undoable
  } else if (event.key === 'Enter' && plain) {
    if (continueLine()) event.preventDefault();
  } else {
    cursorKeyPressed = CURSOR_KEYS.test(event.key);
  }
});
