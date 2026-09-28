// client/ のファイルそのものを読んで、決まりを守っているかを確かめる（ブラウザは使わない）。
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { CLIENT, ROOT } = require('./helpers');

const files = fs.readdirSync(CLIENT).sort();
const read = (name) => fs.readFileSync(path.join(CLIENT, name), 'utf8');
// SVG の要素を作るときの名前空間。読み込みではない。
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

test.describe('client/ の決まり', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'ファイルの確認は 1 回だけ行う');

  test('置くファイルはスタブ 2 つと CSS と JavaScript だけ', () => {
    expect(files).toEqual(['index.html', 'nuu.css', 'nuu.js', 'task.html']);
  });

  // 説明のコメントは除いて、コードだけを確かめる。
  const code = (name) => read(name)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const found = (source, patterns) => patterns.filter((pattern) => pattern.test(source)).map(String);

  for (const name of files) {
    test(`${name} は fetch、XMLHttpRequest、モジュール、外部の URL の読み込みを使わない`, () => {
      const source = code(name);
      expect(found(source, [
        /\bfetch\s*\(/,
        /XMLHttpRequest/,
        /type\s*=\s*["']?module/i,
        /\bimport\s*\(|^\s*import\s|^\s*export\s/m,
        /@import/,
        /url\(\s*["']?(https?:)?\/\//i,
        /(src|href)\s*=\s*["']?(https?:)?\/\//i,
        /\.src\s*=\s*["'`]https?:/i,
      ])).toEqual([]);
      // http:// と https:// は、SVG の名前空間の文字列のほかに書かない。
      const urls = source.match(/https?:\/\/[^\s"'`)]*/g) || [];
      expect(urls.filter((url) => url !== SVG_NAMESPACE)).toEqual([]);
    });
  }

  test('nuu.js はデータを HTML として解釈させない', () => {
    expect(found(code('nuu.js'), [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function/])).toEqual([]);
  });

  for (const [name, prefix, page] of [['task.html', '../', 'task'], ['index.html', '', 'index']]) {
    test(`${name} はスタブの契約を守る`, () => {
      const source = read(name);
      const has = (part) => source.includes(part);
      expect(has('<meta charset="utf-8">')).toBe(true);
      expect(has('<meta name="viewport" content="width=device-width, initial-scale=1">')).toBe(true);
      expect(has(`data-page="${page}"`)).toBe(true);
      const loads = [...source.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((url) => !url.startsWith('data:'));
      expect(loads).toEqual([`${prefix}_client/nuu.css`, `${prefix}_client/nuu.js`, `${prefix}prefs.data.js`]);
      // 好みが最初の描画から当たるよう、nuu.js のあとに好みのファイルを読む。
      expect(source.indexOf('nuu.js')).toBeLessThan(source.indexOf('prefs.data.js'));
      expect(found(source, [/<script>/, /<style>/, /\son\w+="/])).toEqual([]);
    });

    test(`${name} の favicon は説明ページのロゴと同じ`, () => {
      const found = read(name).match(/<link rel="icon" href="data:image\/svg\+xml,([^"]+)">/);
      expect(found).not.toBeNull();
      const logo = fs.readFileSync(path.join(ROOT, 'docs', 'favicon.svg'), 'utf8').trim().replace(/"/g, "'");
      expect(decodeURIComponent(found[1])).toBe(logo);
    });
  }

  test('2 つのスタブの違いは、描く先とリンクの深さとタイトルだけ', () => {
    const normalize = (source) => source
      .replace(/data-page="\w+"/, '')
      .replace(/<title>[^<]*<\/title>/, '')
      .replace(/\.\.\//g, '');
    expect(normalize(read('task.html'))).toBe(normalize(read('index.html')));
  });
});
