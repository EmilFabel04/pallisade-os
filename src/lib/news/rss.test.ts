import { describe, it, expect } from "vitest";
import { parseRssXml, normalizeRss } from "./rss";

const rss = `<?xml version="1.0"?><rss><channel>
  <item>
    <title><![CDATA[GPT-X released]]></title>
    <link>https://news.example.com/gpt-x</link>
    <description><![CDATA[<p>A <b>big</b> model drop with new tools.</p>]]></description>
    <pubDate>Wed, 24 Jun 2026 08:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const atom = `<?xml version="1.0"?><feed>
  <entry>
    <title>Atom item</title>
    <link href="https://atom.example.com/a" />
    <summary>Short summary</summary>
    <updated>2026-06-24T08:00:00Z</updated>
  </entry>
</feed>`;

const atomWithSelfAndAlternate = `<?xml version="1.0"?><feed>
  <entry>
    <title>Atom prefer alternate</title>
    <link rel="self" href="https://feed.example.com/atom" />
    <link rel="alternate" href="https://article.example.com/post" />
    <summary>Body text</summary>
    <updated>2026-06-24T08:00:00Z</updated>
  </entry>
</feed>`;

describe("parseRssXml", () => {
  it("parses RSS items, unwraps CDATA, strips HTML from description", () => {
    const out = parseRssXml(rss);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("GPT-X released");
    expect(out[0].link).toBe("https://news.example.com/gpt-x");
    expect(out[0].description).toBe("A big model drop with new tools.");
    expect(out[0].pubDate).toBe("Wed, 24 Jun 2026 08:00:00 GMT");
  });

  it("parses Atom entries with href links and summary", () => {
    const out = parseRssXml(atom);
    expect(out[0].title).toBe("Atom item");
    expect(out[0].link).toBe("https://atom.example.com/a");
    expect(out[0].description).toBe("Short summary");
  });

  it("Atom entry with rel=self and rel=alternate resolves to alternate url", () => {
    const out = parseRssXml(atomWithSelfAndAlternate);
    expect(out[0].link).toBe("https://article.example.com/post");
  });

  it("clips long description to ≤240 characters", () => {
    const longText = "x".repeat(420);
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>Long item</title>
        <link>https://news.example.com/long</link>
        <description>${longText}</description>
      </item>
    </channel></rss>`;
    const out = parseRssXml(xml);
    expect(out[0].description.length).toBeLessThanOrEqual(240);
  });
});

describe("normalizeRss", () => {
  it("maps to NewsItem with the given category and ISO publishedAt", () => {
    const out = normalizeRss(rss, "ai");
    expect(out[0]).toMatchObject({
      title: "GPT-X released",
      url: "https://news.example.com/gpt-x",
      category: "ai",
    });
    expect(out[0].publishedAt).toBe(new Date("Wed, 24 Jun 2026 08:00:00 GMT").toISOString());
    expect(out[0].source).toBe("news.example.com");
  });

  it("drops RSS <item> missing <link>", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>No link item</title>
        <description>Some text</description>
      </item>
    </channel></rss>`;
    const out = normalizeRss(xml, "ai");
    expect(out).toHaveLength(0);
  });

  it("drops RSS <item> missing <title>", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <link>https://news.example.com/notitle</link>
        <description>Some text</description>
      </item>
    </channel></rss>`;
    const out = normalizeRss(xml, "ai");
    expect(out).toHaveLength(0);
  });
});
