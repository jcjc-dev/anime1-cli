import { describe, expect, it } from 'vitest';
import { looksLikeContentPage, parseEpisodes, parsePagination } from '../src/resolver.js';

const TWO_EPISODES = `
<main>
<article id="post-111" class="post-111 category-foo">
  <header class="entry-header">
    <h2 class="entry-title"><a href="https://anime1.me/111" rel="bookmark">Demo Show [01]</a></h2>
  </header>
  <div class="entry-content">
    <div class="vjscontainer">
      <video id="vjs-aaa" data-apireq="%7B%22c%22%3A%226%22%2C%22e%22%3A%221%22%7D" data-vid="aaa" class="video-js"></video>
    </div>
  </div>
</article>
<article id="post-112" class="post-112 category-foo">
  <header class="entry-header">
    <h2 class="entry-title"><a href="https://anime1.me/112" rel="bookmark">Demo Show [02]</a></h2>
  </header>
  <div class="entry-content">
    <div class="vjscontainer">
      <video id="vjs-bbb" data-apireq="%7B%22c%22%3A%226%22%2C%22e%22%3A%222%22%7D" data-vid="bbb" class="video-js"></video>
    </div>
  </div>
</article>
</main>
`;

const PAGINATED = `
<div class="pagination">
  <a class="page-numbers" href="https://anime1.me/category/2017%e5%b9%b4%e7%a7%8b/show/page/2">2</a>
  <a class="page-numbers" href="https://anime1.me/category/2017%e5%b9%b4%e7%a7%8b/show/page/3">3</a>
  <a class="next page-numbers" href="https://anime1.me/category/2017%e5%b9%b4%e7%a7%8b/show/page/2">下一頁</a>
</div>
`;

describe('parseEpisodes', () => {
  it('extracts title, apiReq and episode number per article, sorted ascending', () => {
    const episodes = parseEpisodes(TWO_EPISODES);
    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toEqual({
      title: 'Demo Show [01]',
      apiReq: '%7B%22c%22%3A%226%22%2C%22e%22%3A%221%22%7D',
      number: 1,
    });
    expect(episodes[1].number).toBe(2);
  });

  it('returns nothing when there are no video players', () => {
    expect(parseEpisodes('<article><h2 class="entry-title">No video</h2></article>')).toEqual([]);
  });
});

describe('parsePagination', () => {
  it('derives the category root and the highest page number', () => {
    const { root, maxPage } = parsePagination(PAGINATED);
    expect(maxPage).toBe(3);
    expect(root).toBe('https://anime1.me/category/2017%e5%b9%b4%e7%a7%8b/show/');
  });

  it('reports a single page when there are no pagination links', () => {
    expect(parsePagination('<div>no pages here</div>')).toEqual({ root: null, maxPage: 1 });
  });
});

describe('looksLikeContentPage', () => {
  it('treats a substantial page with known markers as a content page', () => {
    const html = '<div>' + 'x'.repeat(1100) + '<article class="vjscontainer"></article></div>';
    expect(looksLikeContentPage(html)).toBe(true);
  });
  it('treats a short/empty stub as not a content page', () => {
    expect(looksLikeContentPage('')).toBe(false);
    expect(looksLikeContentPage('<html><body>blocked</body></html>')).toBe(false);
  });
});
