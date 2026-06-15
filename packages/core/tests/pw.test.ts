import { describe, expect, it } from 'vitest';
import { parsePwEpisodePage, parsePwSeasonPage, selectMp4Source } from '../src/pw.js';

const SEASON = `
<main>
<article>
  <h2 class="entry-title"><a href="https://anime1.pw/352" rel="bookmark">這樣高大的女孩子你喜歡嗎？ [09]</a></h2>
</article>
<article>
  <h2 class="entry-title"><a href="https://anime1.pw/351" rel="bookmark">這樣高大的女孩子你喜歡嗎？ [08]</a></h2>
</article>
<nav class="navigation pagination">
  <div class="nav-previous"><a href="https://anime1.pw/?cat=60&paged=2">較舊的文章</a></div>
</nav>
</main>
`;

const EPISODE = `
<article>
  <h1 class="entry-title">這樣高大的女孩子你喜歡嗎？ [06]</h1>
  <div class="entry-content">
    <video class="video-js" controls>
      <source src="//pwvideo.lolicdn.net/60/6.mp4?h=AC9R1IbuciysqffsAmVpzA&e=1781561327" type="video/mp4">
    </video>
  </div>
</article>
`;

describe('parsePwSeasonPage', () => {
  it('extracts episode page URLs, titles, and the older-posts next URL', () => {
    const page = parsePwSeasonPage(SEASON, 'https://anime1.pw/?cat=60');
    expect(page.episodes).toEqual([
      { url: 'https://anime1.pw/352', title: '這樣高大的女孩子你喜歡嗎？ [09]' },
      { url: 'https://anime1.pw/351', title: '這樣高大的女孩子你喜歡嗎？ [08]' },
    ]);
    expect(page.nextUrl).toBe('https://anime1.pw/?cat=60&paged=2');
  });

  it('reports no next URL when pagination is absent', () => {
    expect(parsePwSeasonPage('<main></main>', 'https://anime1.pw/?cat=60').nextUrl).toBeNull();
  });
});

describe('parsePwEpisodePage', () => {
  it('resolves a protocol-relative MP4 source and the title', () => {
    const { src, title } = parsePwEpisodePage(EPISODE, 'https://anime1.pw/349');
    expect(src).toBe('https://pwvideo.lolicdn.net/60/6.mp4?h=AC9R1IbuciysqffsAmVpzA&e=1781561327');
    expect(title).toBe('這樣高大的女孩子你喜歡嗎？ [06]');
  });

  it('throws when no <source> tag is present', () => {
    expect(() => parsePwEpisodePage('<h1 class="entry-title">x</h1>', 'https://anime1.pw/1')).toThrow(
      /missing an MP4/,
    );
  });
});

describe('selectMp4Source', () => {
  it('prefers an MP4 source over other candidates', () => {
    const html = `
      <source src="https://cdn/x.webm" type="video/webm">
      <source src="https://cdn/x.mp4" type="video/mp4">`;
    expect(selectMp4Source(html, 'https://anime1.pw/1')).toBe('https://cdn/x.mp4');
  });

  it('falls back to the first source when none declare MP4', () => {
    const html = '<source src="https://cdn/only.webm" type="video/webm">';
    expect(selectMp4Source(html, 'https://anime1.pw/1')).toBe('https://cdn/only.webm');
  });
});
