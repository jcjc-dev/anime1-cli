# anime1-core

The engine behind [anime1-cli](https://github.com/jcjc-dev/anime1-cli). It reads the anime1.me catalogue, resolves episode video URLs, and downloads them. There is no UI and no runtime dependencies, so you can build your own front end on top of it.

## Install

```sh
npm install anime1-core
```

Needs Node.js 20 or newer.

## Use

```ts
import { fetchCatalog, fetchEpisodes, resolveSource, downloadSource } from 'anime1-core';

const catalogue = await fetchCatalog();
const series = catalogue.find((a) => a.title.includes('Sunshine'));

const episodes = await fetchEpisodes(series.catId);
const source = await resolveSource(episodes[0].apiReq);

await downloadSource(source, './ep1.mp4', {
  connections: 6,
  onProgress: ({ received, total }) => {
    if (total) process.stdout.write(`\r${((received / total) * 100).toFixed(1)}%`);
  },
});
```

See the [main project](https://github.com/jcjc-dev/anime1-cli) for the CLI, the full docs, and the legal notes.

## License

MIT. See [LICENSE](./LICENSE).
