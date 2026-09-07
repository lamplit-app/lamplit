import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  META_FILES,
  fetchedFromElsewhere,
  htmlMarkdownLinks,
  includedFiles,
  liquidInComments,
  markdownLinks,
  normalise,
  withoutCode,
  withoutComments,
} from '../lib/docs-scan.mjs';

/** As a page arrives here: written on Windows, read as one line per line. */
function page(text) {
  return withoutCode(normalise(text.replace(/\n/g, '\r\n')));
}

describe('the links on a page', () => {
  it('reads the target, the text and the fragment apart', () => {
    const [link] = markdownLinks(page('See [Chapters](chapters.md#closing) for the rest.\n'));
    assert.equal(link.target, 'chapters.md#closing');
    assert.equal(link.path, 'chapters.md');
    assert.equal(link.text, 'Chapters');
    assert.equal(link.picture, false);
    assert.equal(link.external, false);
  });

  it('catches the one whose text wraps, which is the trap', () => {
    // jekyll-relative-links does not match this at all, so it ships as .md and
    // the visitor gets a page of raw markdown. The page still builds.
    const wrapped = markdownLinks(
      page('Read [the chapter\nguide](chapters.md) and [this one](index.md).\n'),
    );
    assert.deepEqual(
      wrapped.map((link) => [link.path, link.wrapped]),
      [
        ['chapters.md', true],
        ['index.md', false],
      ],
    );
  });

  it('says which targets no local check can speak for', () => {
    const links = markdownLinks(
      page('[Out](https://example.com/x) [Write](mailto:a@b.c) [Down](#later) [In](x.md)\n'),
    );
    assert.deepEqual(
      links.map((link) => link.external),
      [true, true, true, false],
    );
  });

  it('tells a picture from a link, since only one of them is rewritten', () => {
    const links = markdownLinks(page('![The scene sheet](images/scene.png)\n\n[A page](a.md)\n'));
    assert.deepEqual(
      links.map((link) => [link.picture, link.path]),
      [
        [true, 'images/scene.png'],
        [false, 'a.md'],
      ],
    );
  });

  it('does not read the examples a page gives of links', () => {
    // Code and comments talk about links; a fenced `[x](nowhere.md)` is not one,
    // and reporting it would be a problem nobody can fix.
    const source = page(
      'Real: [Chapters](chapters.md)\n\n' +
        '```\n[Example](nowhere.md)\n```\n\n' +
        '    [Indented](also-nowhere.md)\n\n' +
        'Inline `[Ticked](ticked.md)` too.\n\n' +
        '<!-- [Commented](commented.md) -->\n',
    );
    assert.deepEqual(
      markdownLinks(source).map((link) => link.path),
      ['chapters.md'],
    );
  });
});

describe('a link written as HTML', () => {
  it('is found when it points at markdown, which is never rewritten', () => {
    assert.deepEqual(
      htmlMarkdownLinks(page('<a href="chapters.md">Chapters</a> and <a href="x.md#top">X</a>\n')),
      ['chapters.md', 'x.md'],
    );
  });

  it('says nothing about the .html a raw-HTML page is right to write', () => {
    assert.deepEqual(htmlMarkdownLinks(page('<a href="chapters.html">Chapters</a>\n')), []);
  });
});

describe('a Liquid tag hiding in a comment', () => {
  it('is found, because Liquid reads it and the Pages build stops there', () => {
    // The fault that broke the deploy on 2026-09-05: an `if` in a note about
    // the template it came from is an `if` with no end.
    const raw = normalise('<div>\n<!-- from the theme: {% if page.title %} ... -->\n</div>\n');
    assert.deepEqual(liquidInComments(raw), [{ tag: 'if', index: 6 }]);
  });

  it('reads a whitespace-trimming tag as a tag', () => {
    assert.deepEqual(
      liquidInComments('<!-- {%- for item in x -%} -->').map((found) => found.tag),
      ['for'],
    );
  });

  it('says nothing about a comment that is only prose, or a tag out in the open', () => {
    assert.deepEqual(liquidInComments('<!-- a note about nothing -->'), []);
    // Out in the open it is a tag on purpose, and Jekyll is right to run it.
    assert.deepEqual(liquidInComments('{% if page.title %}{% endif %}'), []);
  });
});

describe('what the browser is made to fetch', () => {
  it('names the kind of each thing that comes from another host', () => {
    const found = fetchedFromElsewhere(
      withoutComments(
        '<script src="https://cdn.example.com/a.js"></script>\n' +
          '<link rel="stylesheet" href="https://fonts.example.com/c.css">\n' +
          '<img src="//example.com/pic.png">\n' +
          '<iframe src="https://video.example.com/v"></iframe>\n' +
          '<style>@import "https://example.com/i.css"; a { background: url(https://example.com/b.png) }</style>\n',
      ),
    );
    assert.deepEqual(found, [
      { target: 'https://cdn.example.com/a.js', what: 'a script' },
      { target: 'https://fonts.example.com/c.css', what: 'a stylesheet, font or icon' },
      { target: '//example.com/pic.png', what: 'an embedded file' },
      { target: 'https://video.example.com/v', what: 'an embedded file' },
      { target: 'https://example.com/i.css', what: 'an imported stylesheet' },
      { target: 'https://example.com/b.png', what: 'a file named in CSS' },
    ]);
  });

  it('lets everything served from this site alone', () => {
    assert.deepEqual(
      fetchedFromElsewhere(
        '<link rel="stylesheet" href="/assets/style.css">\n' +
          '<img src="images/scene.png">\n' +
          '<script src="js/app.js"></script>\n',
      ),
      [],
    );
  });

  it('catches a picture pulled in from elsewhere by markdown', () => {
    assert.deepEqual(fetchedFromElsewhere(page('![A badge](https://img.shields.io/x.svg)\n')), [
      { target: 'https://img.shields.io/x.svg', what: 'a picture' },
    ]);
  });

  it('does not read a note in a comment as something anybody fetches', () => {
    const raw = '<!-- we used to load <script src="https://cdn.example.com/a.js"> -->\n';
    assert.deepEqual(fetchedFromElsewhere(withoutComments(raw)), []);
  });
});

describe('the include: block of _config.yml', () => {
  it('is read on its own, and not header_pages beside it', () => {
    // header_pages lists README.md too. Reading both would have this check
    // pass while the site served raw markdown.
    const config = normalise(
      'title: Lamplit\ninclude:\n  - README.md\n  - LICENSE.md\nheader_pages:\n  - index.md\n  - CONTRIBUTING.md\n',
    );
    assert.deepEqual([...includedFiles(config)], ['README.md', 'LICENSE.md']);
  });

  it('reads a config written with CRLF, as this repository writes it', () => {
    assert.deepEqual([...includedFiles('include:\r\n  - README.md\r\n')], ['README.md']);
  });

  it('is empty when nothing is included, rather than everything', () => {
    assert.equal(includedFiles('title: Lamplit\n').size, 0);
  });

  it('knows which files Jekyll will not build a page from', () => {
    assert.deepEqual(META_FILES, [
      'README.md',
      'CONTRIBUTING.md',
      'CODE_OF_CONDUCT.md',
      'LICENSE.md',
    ]);
  });
});
